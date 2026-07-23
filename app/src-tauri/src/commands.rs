use crate::player::{Player, PlayerKind};
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Serialize)]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
}

const VIDEO_EXTENSIONS: &[&str] = &["mkv", "mp4", "avi", "webm", "ts", "m2ts", "mov"];

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub size: u64,
    pub path: String,
}

#[tauri::command]
pub async fn set_player(state: State<'_, Player>, kind: String) -> Result<(), String> {
    state.set_kind(PlayerKind::parse(&kind)).await;
    Ok(())
}

#[tauri::command]
pub async fn player_start(app: AppHandle, state: State<'_, Player>) -> Result<(), String> {
    state.start(&app).await
}

#[tauri::command]
pub async fn player_load(app: AppHandle, state: State<'_, Player>, path: String) -> Result<(), String> {
    state.load(&app, path).await
}

#[tauri::command]
pub async fn player_set_pause(state: State<'_, Player>, paused: bool) -> Result<(), String> {
    state.set_pause(paused).await
}

#[tauri::command]
pub async fn player_seek(state: State<'_, Player>, pos: f64) -> Result<(), String> {
    state.seek(pos).await
}

#[tauri::command]
pub async fn player_set_speed(state: State<'_, Player>, speed: f64) -> Result<(), String> {
    state.set_speed(speed).await
}

#[tauri::command]
pub async fn player_get_position(state: State<'_, Player>) -> Result<Option<f64>, String> {
    state.position().await
}

#[tauri::command]
pub async fn player_osd(state: State<'_, Player>, data: String) -> Result<(), String> {
    state.osd(data).await
}

#[tauri::command]
pub async fn player_stop(state: State<'_, Player>) -> Result<(), String> {
    state.stop().await;
    Ok(())
}

/// Все видеофайлы папки (без рекурсии) — для плейлиста и авто-подтягивания серий.
#[tauri::command]
pub fn list_videos(dir: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("папка недоступна: {e}"))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let is_video = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
        if !is_video || !path.is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            size: meta.len(),
            path: path.to_string_lossy().into_owned(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn probe_file(path: String) -> Result<FileInfo, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("файл недоступен: {e}"))?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(path);
    Ok(FileInfo { name, size: meta.len() })
}
