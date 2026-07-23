//! JSON IPC с mpv через named pipe: запрос/ответ по request_id,
//! наблюдаемые свойства и различение «эхо своей команды» / «действие юзера в mpv».

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, WriteHalf};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

const OBSERVED: &[&str] = ["pause", "time-pos", "speed", "duration", "eof-reached", "seeking", "path"].as_slice();
const EXPECT_TTL: Duration = Duration::from_millis(500);
const TIME_POS_EMIT_INTERVAL: Duration = Duration::from_millis(250);

struct Expectation {
    prop: String,
    value: Value,
    deadline: Instant,
}

pub struct Ipc {
    writer: Mutex<WriteHalf<NamedPipeClient>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    expectations: Mutex<Vec<Expectation>>,
    own_seeks: AtomicU32,
}

impl Ipc {
    /// mpv поднимает pipe-сервер не мгновенно после старта процесса — ждём с ретраями.
    pub async fn connect(pipe_name: &str, app: AppHandle) -> Result<Arc<Ipc>, String> {
        let client = {
            let mut attempt = 0;
            loop {
                match ClientOptions::new().open(pipe_name) {
                    Ok(c) => break c,
                    Err(e) if attempt >= 100 => return Err(format!("mpv pipe не открылся: {e}")),
                    Err(_) => {}
                }
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        };

        let (reader, writer) = tokio::io::split(client);
        let ipc = Arc::new(Ipc {
            writer: Mutex::new(writer),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            expectations: Mutex::new(Vec::new()),
            own_seeks: AtomicU32::new(0),
        });

        tokio::spawn(read_loop(reader, ipc.clone(), app));

        for (i, prop) in OBSERVED.iter().enumerate() {
            ipc.command(json!(["observe_property", i as u64 + 1, prop])).await?;
        }
        Ok(ipc)
    }

    pub async fn command(&self, cmd: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let line = json!({ "command": cmd, "request_id": id }).to_string() + "\n";
        self.writer
            .lock()
            .await
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("mpv pipe write: {e}"))?;

        match timeout(Duration::from_secs(2), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("mpv ipc закрыт".into()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err("mpv не ответил за 2с".into())
            }
        }
    }

    /// set_property с пометкой «это наша команда»: ближайшее совпадающее
    /// property-change будет распознано как эхо, а не действие юзера.
    pub async fn set_property(&self, prop: &str, value: Value) -> Result<(), String> {
        self.expectations.lock().await.push(Expectation {
            prop: prop.into(),
            value: value.clone(),
            deadline: Instant::now() + EXPECT_TTL,
        });
        self.command(json!(["set_property", prop, value])).await.map(|_| ())
    }

    pub async fn seek(&self, pos: f64) -> Result<(), String> {
        self.own_seeks.fetch_add(1, Ordering::Relaxed);
        let result = self.command(json!(["seek", pos, "absolute+exact"])).await;
        if result.is_err() {
            self.own_seeks.fetch_sub(1, Ordering::Relaxed);
        }
        result.map(|_| ())
    }

    pub async fn get_property(&self, prop: &str) -> Result<Value, String> {
        self.command(json!(["get_property", prop])).await
    }

    async fn consume_expectation(&self, prop: &str, value: &Value) -> bool {
        let now = Instant::now();
        let mut list = self.expectations.lock().await;
        list.retain(|e| e.deadline > now);
        if let Some(i) = list.iter().position(|e| e.prop == prop && values_match(&e.value, value)) {
            list.remove(i);
            true
        } else {
            false
        }
    }

    fn consume_own_seek(&self) -> bool {
        self.own_seeks
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1))
            .is_ok()
    }
}

fn values_match(expected: &Value, actual: &Value) -> bool {
    match (expected.as_f64(), actual.as_f64()) {
        (Some(a), Some(b)) => (a - b).abs() < 0.01,
        _ => expected == actual,
    }
}

async fn read_loop(
    reader: tokio::io::ReadHalf<NamedPipeClient>,
    ipc: Arc<Ipc>,
    app: AppHandle,
) {
    let mut lines = BufReader::new(reader).lines();
    let mut last_time_pos_emit = Instant::now() - TIME_POS_EMIT_INTERVAL;
    // Первое уведомление каждого свойства — начальное значение после observe, не действие юзера.
    let mut seen_props: HashSet<String> = HashSet::new();

    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };

        if let Some(id) = msg.get("request_id").and_then(Value::as_u64) {
            if let Some(tx) = ipc.pending.lock().await.remove(&id) {
                let result = if msg.get("error").and_then(Value::as_str) == Some("success") {
                    Ok(msg.get("data").cloned().unwrap_or(Value::Null))
                } else {
                    Err(msg.get("error").and_then(Value::as_str).unwrap_or("unknown").to_string())
                };
                let _ = tx.send(result);
            }
            continue;
        }

        match msg.get("event").and_then(Value::as_str) {
            Some("property-change") => {
                let Some(name) = msg.get("name").and_then(Value::as_str) else { continue };
                let value = msg.get("data").cloned().unwrap_or(Value::Null);

                if name == "time-pos" {
                    if last_time_pos_emit.elapsed() < TIME_POS_EMIT_INTERVAL {
                        continue;
                    }
                    last_time_pos_emit = Instant::now();
                    let _ = app.emit("mpv://prop", json!({ "name": name, "value": value }));
                    continue;
                }

                let origin = if seen_props.insert(name.to_string()) {
                    "init"
                } else if ipc.consume_expectation(name, &value).await {
                    "own"
                } else {
                    "user"
                };
                let _ = app.emit("mpv://prop", json!({ "name": name, "value": value, "origin": origin }));
            }
            Some("seek") => {
                let own = ipc.consume_own_seek();
                let _ = app.emit("mpv://event", json!({ "event": "seek", "origin": if own { "own" } else { "user" } }));
            }
            Some(ev @ ("playback-restart" | "file-loaded" | "end-file" | "idle")) => {
                let _ = app.emit("mpv://event", json!({ "event": ev }));
            }
            _ => {}
        }
    }

    // pipe закрылся — mpv умер или вышел
    let _ = app.emit("mpv://event", json!({ "event": "ipc-closed" }));
    ipc.pending.lock().await.clear();
}
