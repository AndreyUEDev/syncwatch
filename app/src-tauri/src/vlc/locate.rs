//! Поиск vlc.exe: env SYNCWATCH_VLC → стандартные пути → PATH.

use std::path::PathBuf;
use tauri::AppHandle;

pub fn find_vlc(_app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("SYNCWATCH_VLC") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
    }

    #[cfg(windows)]
    for base in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(dir) = std::env::var_os(base) {
            let candidate = PathBuf::from(dir).join("VideoLAN").join("VLC").join("vlc.exe");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    let name = if cfg!(windows) { "vlc.exe" } else { "vlc" };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err("VLC не найден. Установите VLC или выберите встроенный плеер mpv в настройках.".into())
}
