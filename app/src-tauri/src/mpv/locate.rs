//! Поиск mpv.exe: рядом с приложением (бандл) -> ресурсы Tauri -> PATH.

use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

pub fn find_mpv(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(overridden) = std::env::var_os("SYNCWATCH_MPV") {
        let p = PathBuf::from(overridden);
        if p.is_file() {
            return Ok(p);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sibling = dir.join("mpv").join("mpv.exe");
            if sibling.is_file() {
                return Ok(sibling);
            }
        }
    }

    if let Ok(bundled) = app.path().resolve("mpv/mpv.exe", BaseDirectory::Resource) {
        if bundled.is_file() {
            return Ok(bundled);
        }
    }

    let name = if cfg!(windows) { "mpv.exe" } else { "mpv" };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err("mpv не найден: нет ни в комплекте приложения, ни в PATH".into())
}
