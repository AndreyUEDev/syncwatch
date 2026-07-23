import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const CHECK_INTERVAL_MS = 6 * 3600_000;

/**
 * Обновления через GitHub Releases (latest.json, подпись minisign).
 * autoInstall=true — качаем и ставим сами, юзеру остаётся плашка «Перезапустить».
 */
class UpdaterStore {
  available = $state(false);
  version = $state('');
  downloading = $state(false);
  /** Обновление скачано и установлено — нужен только перезапуск. */
  readyToRestart = $state(false);
  error = $state('');
  autoInstall = $state(localStorage.getItem('syncwatch.autoUpdate') !== '0');

  private update: Update | null = null;

  start() {
    this.checkNow();
    setInterval(() => this.checkNow(), CHECK_INTERVAL_MS);
  }

  setAutoInstall(v: boolean) {
    this.autoInstall = v;
    localStorage.setItem('syncwatch.autoUpdate', v ? '1' : '0');
  }

  async checkNow() {
    try {
      const update = await check();
      if (!update) return;
      this.update = update;
      this.version = update.version;
      this.available = true;
      if (this.autoInstall) await this.install();
    } catch (e) {
      // нет сети / нет релизов — молчим, попробуем в следующий раз
      console.warn('update check failed', e);
    }
  }

  async install() {
    if (!this.update || this.downloading || this.readyToRestart) return;
    this.downloading = true;
    this.error = '';
    try {
      await this.update.downloadAndInstall();
      this.readyToRestart = true;
    } catch (e) {
      this.error = String(e);
    } finally {
      this.downloading = false;
    }
  }

  async restart() {
    await relaunch();
  }
}

export const updater = new UpdaterStore();
