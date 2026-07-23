//! Диспетчер плееров: маршрутизирует команды к выбранному бэкенду (mpv или VLC).
//! Оба бэкенда шлют события в одни каналы (mpv://prop, mpv://event), UI их не различает.

use crate::mpv::{Ipc, Mpv};
use crate::vlc::{Ctl as VlcCtl, Vlc};
use serde_json::json;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

#[derive(Clone, Copy, PartialEq, Default)]
pub enum PlayerKind {
    #[default]
    Mpv,
    Vlc,
}

impl PlayerKind {
    pub fn parse(s: &str) -> PlayerKind {
        match s {
            "vlc" => PlayerKind::Vlc,
            _ => PlayerKind::Mpv,
        }
    }
}

#[derive(Default)]
pub struct Player {
    kind: Mutex<PlayerKind>,
    mpv: Mutex<Option<Mpv>>,
    vlc: Mutex<Option<Vlc>>,
}

impl Player {
    /// Сменить выбранный плеер; работающий бэкенд другого типа глушится.
    pub async fn set_kind(&self, kind: PlayerKind) {
        *self.kind.lock().await = kind;
        match kind {
            PlayerKind::Mpv => {
                if let Some(mut v) = self.vlc.lock().await.take() {
                    v.quit().await;
                }
            }
            PlayerKind::Vlc => {
                if let Some(mut m) = self.mpv.lock().await.take() {
                    m.quit().await;
                }
            }
        }
    }

    pub async fn kind(&self) -> PlayerKind {
        *self.kind.lock().await
    }

    async fn ensure_mpv(&self, app: &AppHandle) -> Result<Arc<Ipc>, String> {
        let mut slot = self.mpv.lock().await;
        if let Some(m) = slot.as_mut() {
            if m.alive() {
                return Ok(m.ipc.clone());
            }
            *slot = None;
        }
        let mpv = Mpv::spawn(app).await?;
        let ipc = mpv.ipc.clone();
        *slot = Some(mpv);
        Ok(ipc)
    }

    async fn ensure_vlc(&self, app: &AppHandle) -> Result<Arc<VlcCtl>, String> {
        let mut slot = self.vlc.lock().await;
        if let Some(v) = slot.as_mut() {
            if v.alive() {
                return Ok(v.ctl.clone());
            }
            *slot = None;
        }
        let vlc = Vlc::spawn(app).await?;
        let ctl = vlc.ctl.clone();
        *slot = Some(vlc);
        Ok(ctl)
    }

    pub async fn start(&self, app: &AppHandle) -> Result<(), String> {
        match self.kind().await {
            PlayerKind::Mpv => self.ensure_mpv(app).await.map(|_| ()),
            PlayerKind::Vlc => self.ensure_vlc(app).await.map(|_| ()),
        }
    }

    pub async fn load(&self, app: &AppHandle, path: String) -> Result<(), String> {
        match self.kind().await {
            PlayerKind::Mpv => self
                .ensure_mpv(app)
                .await?
                .command(json!(["loadfile", path, "replace"]))
                .await
                .map(|_| ()),
            PlayerKind::Vlc => self.ensure_vlc(app).await?.load(&path).await,
        }
    }

    pub async fn set_pause(&self, paused: bool) -> Result<(), String> {
        match self.kind().await {
            PlayerKind::Mpv => self.mpv_ipc().await?.set_property("pause", json!(paused)).await,
            PlayerKind::Vlc => self.vlc_ctl().await?.set_pause(paused).await,
        }
    }

    pub async fn seek(&self, pos: f64) -> Result<(), String> {
        match self.kind().await {
            PlayerKind::Mpv => self.mpv_ipc().await?.seek(pos).await,
            PlayerKind::Vlc => self.vlc_ctl().await?.seek(pos).await,
        }
    }

    pub async fn set_speed(&self, speed: f64) -> Result<(), String> {
        match self.kind().await {
            PlayerKind::Mpv => self.mpv_ipc().await?.set_property("speed", json!(speed)).await,
            PlayerKind::Vlc => self.vlc_ctl().await?.set_speed(speed).await,
        }
    }

    pub async fn position(&self) -> Result<Option<f64>, String> {
        match self.kind().await {
            PlayerKind::Mpv => {
                Ok(self.mpv_ipc().await?.get_property("time-pos").await.ok().and_then(|v| v.as_f64()))
            }
            PlayerKind::Vlc => Ok(self.vlc_ctl().await?.position().await),
        }
    }

    /// Оверлей-чат поверх видео. Поддерживается только mpv; для VLC — тихо игнорируется.
    pub async fn osd(&self, data: String) -> Result<(), String> {
        if self.kind().await != PlayerKind::Mpv {
            return Ok(());
        }
        let ipc = self.mpv_ipc().await?;
        ipc.command(json!({
            "name": "osd-overlay",
            "id": 1,
            "format": "ass-events",
            "data": data,
            "res_x": 0,
            "res_y": 720,
            "z": 10
        }))
        .await
        .map(|_| ())
    }

    pub async fn stop(&self) {
        if let Some(mut m) = self.mpv.lock().await.take() {
            m.quit().await;
        }
        if let Some(mut v) = self.vlc.lock().await.take() {
            v.quit().await;
        }
    }

    async fn mpv_ipc(&self) -> Result<Arc<Ipc>, String> {
        self.mpv
            .lock()
            .await
            .as_ref()
            .map(|m| m.ipc.clone())
            .ok_or_else(|| "плеер не запущен".to_string())
    }

    async fn vlc_ctl(&self) -> Result<Arc<VlcCtl>, String> {
        self.vlc
            .lock()
            .await
            .as_ref()
            .map(|v| v.ctl.clone())
            .ok_or_else(|| "плеер не запущен".to_string())
    }
}
