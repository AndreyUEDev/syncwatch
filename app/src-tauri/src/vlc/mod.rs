//! VLC-бэкенд через встроенный HTTP-интерфейс.
//!
//! VLC не шлёт события — состояние опрашивается (status.json ~4 Гц). Из окна VLC
//! ловим только play/pause юзера (сравнением состояния); ручной seek в самом VLC
//! не распознаётся (ограничение опроса) — управление перемоткой идёт через UI приложения.

mod locate;

use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const POLL_INTERVAL: Duration = Duration::from_millis(200);
const TIME_EMIT_INTERVAL: Duration = Duration::from_millis(250);

pub struct Vlc {
    child: Child,
    pub ctl: Arc<Ctl>,
}

/// Управляющая часть (клонируется в poll-задачу и в команды, чтобы не держать mutex через await).
pub struct Ctl {
    client: reqwest::Client,
    port: u16,
    password: String,
    expect_pause: Mutex<Option<bool>>,
    own_seeks: AtomicU32,
    state: Mutex<Observed>,
}

#[derive(Default, Clone)]
struct Observed {
    pos: f64,
    duration: f64,
    paused: bool,
    speed: f64,
    started: bool,
}

#[derive(Deserialize)]
struct Status {
    state: String,
    #[serde(default)]
    time: f64,
    #[serde(default)]
    length: f64,
    #[serde(default)]
    position: f64,
    #[serde(default = "one")]
    rate: f64,
}

fn one() -> f64 {
    1.0
}

impl Vlc {
    pub async fn spawn(app: &AppHandle) -> Result<Vlc, String> {
        let exe = locate::find_vlc(app)?;
        let port = 18000 + (std::process::id() % 20000) as u16;
        let password = format!("sw{}", rand_token());

        let mut cmd = Command::new(&exe);
        cmd.args([
            "--intf",
            "qt",
            "--extraintf",
            "http",
            "--http-host",
            "127.0.0.1",
            "--http-port",
            &port.to_string(),
            "--http-password",
            &password,
            "--no-one-instance",
            "--no-video-title-show",
            "--no-playlist-enqueue",
        ]);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);

        let child = cmd
            .spawn()
            .map_err(|e| format!("не удалось запустить VLC ({}): {e}", exe.display()))?;

        let ctl = Arc::new(Ctl {
            client: reqwest::Client::builder()
                .no_proxy()
                .build()
                .map_err(|e| e.to_string())?,
            port,
            password,
            expect_pause: Mutex::new(None),
            own_seeks: AtomicU32::new(0),
            state: Mutex::new(Observed { speed: 1.0, ..Default::default() }),
        });

        // Дождаться, пока HTTP-интерфейс поднимется.
        let mut ok = false;
        for _ in 0..100 {
            if ctl.fetch_status().await.is_some() {
                ok = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !ok {
            return Err("VLC HTTP-интерфейс не поднялся".into());
        }

        tokio::spawn(poll_loop(ctl.clone(), app.clone()));
        let _ = app.emit("mpv://event", json!({ "event": "started" }));
        Ok(Vlc { child, ctl })
    }

    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub async fn quit(&mut self) {
        let _ = self.child.kill().await;
    }
}

impl Ctl {
    fn url(&self, query: &str) -> String {
        format!("http://127.0.0.1:{}/requests/status.json{query}", self.port)
    }

    async fn request(&self, query: &str) -> Option<Status> {
        let resp = self
            .client
            .get(self.url(query))
            .basic_auth("", Some(&self.password))
            .send()
            .await
            .ok()?;
        resp.json::<Status>().await.ok()
    }

    async fn fetch_status(&self) -> Option<Status> {
        self.request("").await
    }

    pub async fn load(&self, path: &str) -> Result<(), String> {
        *self.state.lock().await = Observed { speed: 1.0, ..Default::default() };
        let uri = urlencoding::encode(path);
        self.request(&format!("?command=in_play&input={uri}"))
            .await
            .map(|_| ())
            .ok_or_else(|| "VLC не принял файл".into())
    }

    pub async fn set_pause(&self, paused: bool) -> Result<(), String> {
        *self.expect_pause.lock().await = Some(paused);
        let cmd = if paused { "pl_forcepause" } else { "pl_forceresume" };
        self.request(&format!("?command={cmd}"))
            .await
            .map(|_| ())
            .ok_or_else(|| "VLC pause failed".into())
    }

    pub async fn seek(&self, pos: f64) -> Result<(), String> {
        self.own_seeks.fetch_add(1, Ordering::Relaxed);
        self.request(&format!("?command=seek&val={}", pos as i64))
            .await
            .map(|_| ())
            .ok_or_else(|| "VLC seek failed".into())
    }

    pub async fn set_speed(&self, speed: f64) -> Result<(), String> {
        self.request(&format!("?command=rate&val={speed}"))
            .await
            .map(|_| ())
            .ok_or_else(|| "VLC rate failed".into())
    }

    pub async fn position(&self) -> Option<f64> {
        Some(self.state.lock().await.pos)
    }
}

fn rand_token() -> String {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", n)
}

async fn poll_loop(ctl: Arc<Ctl>, app: AppHandle) {
    let mut last_time_emit = Instant::now() - TIME_EMIT_INTERVAL;

    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let Some(status) = ctl.fetch_status().await else {
            // HTTP пропал — VLC закрыт
            let _ = app.emit("mpv://event", json!({ "event": "ipc-closed" }));
            break;
        };

        let paused = status.state == "paused";
        let stopped = status.state == "stopped";
        let duration = status.length;
        let pos = if status.length > 0.0 {
            status.position * status.length
        } else {
            status.time
        };

        let mut st = ctl.state.lock().await;
        let prev = st.clone();
        st.pos = pos;
        st.duration = duration;
        st.paused = paused || stopped;
        st.speed = status.rate;

        // первый переход в playing/paused после load = file-loaded
        if !prev.started && !stopped && duration > 0.0 {
            st.started = true;
            let _ = app.emit("mpv://event", json!({ "event": "file-loaded" }));
            let _ = app.emit("mpv://prop", json!({ "name": "duration", "value": duration, "origin": "init" }));
        }

        // конец файла
        if prev.started && stopped {
            st.started = false;
            let _ = app.emit("mpv://prop", json!({ "name": "eof-reached", "value": true, "origin": "user" }));
        }

        // пауза: отличаем эхо своей команды от действия юзера в окне VLC
        if !stopped && paused != prev.paused {
            let mut expect = ctl.expect_pause.lock().await;
            let origin = if *expect == Some(paused) {
                *expect = None;
                "own"
            } else {
                "user"
            };
            let _ = app.emit("mpv://prop", json!({ "name": "pause", "value": paused, "origin": origin }));
        }

        if (status.rate - prev.speed).abs() > 0.001 {
            let _ = app.emit("mpv://prop", json!({ "name": "speed", "value": status.rate, "origin": "own" }));
        }

        drop(st);

        if !paused && !stopped && last_time_emit.elapsed() >= TIME_EMIT_INTERVAL {
            last_time_emit = Instant::now();
            let _ = app.emit("mpv://prop", json!({ "name": "time-pos", "value": pos }));
        }
    }
}
