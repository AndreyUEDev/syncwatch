//! Супервизор mpv: запуск процесса, IPC-подключение, завершение.

mod ipc;
mod locate;

pub use ipc::Ipc;

use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};

pub struct Mpv {
    child: Child,
    pub ipc: Arc<Ipc>,
}

impl Mpv {
    pub async fn spawn(app: &AppHandle) -> Result<Mpv, String> {
        let exe = locate::find_mpv(app)?;
        let pipe_name = format!(r"\\.\pipe\syncwatch-mpv-{}", std::process::id());

        let mut cmd = Command::new(&exe);
        cmd.args([
            &format!("--input-ipc-server={pipe_name}"),
            "--idle=yes",
            "--force-window=yes",
            "--keep-open=yes",
            "--hr-seek=yes",
            "--no-terminal",
            "--title=Syncwatch",
        ]);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: без консольного окна

        let child = cmd
            .spawn()
            .map_err(|e| format!("не удалось запустить mpv ({}): {e}", exe.display()))?;
        let ipc = Ipc::connect(&pipe_name, app.clone()).await?;

        let _ = app.emit("mpv://event", json!({ "event": "started" }));
        Ok(Mpv { child, ipc })
    }

    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub async fn quit(&mut self) {
        let _ = self.ipc.command(json!(["quit"])).await;
        let _ = self.child.kill().await;
    }
}
