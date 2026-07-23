mod commands;
mod mpv;
mod player;
mod vlc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(player::Player::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Регистрация схемы syncwatch:// для dev/unpackaged (в проде ставит инсталлятор).
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_player,
            commands::player_start,
            commands::player_load,
            commands::player_set_pause,
            commands::player_seek,
            commands::player_set_speed,
            commands::player_get_position,
            commands::player_osd,
            commands::player_stop,
            commands::probe_file,
            commands::list_videos,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<player::Player>();
                tauri::async_runtime::block_on(state.stop());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
