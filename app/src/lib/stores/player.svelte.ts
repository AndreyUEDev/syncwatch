import { mpv, type MpvEvent, type MpvProp } from '$lib/player/mpv';

/**
 * Зеркало состояния mpv. Каждое действие юзера, сделанное в самом окне mpv
 * (пробел, стрелки), приходит с origin 'user' и отдаётся в onUserAction —
 * sync-движок превращает его в action для комнаты.
 */
class PlayerStore {
  running = $state(false);
  path = $state<string | null>(null);
  position = $state(0);
  duration = $state(0);
  paused = $state(true);
  speed = $state(1);
  eof = $state(false);

  onUserAction: ((kind: 'play' | 'pause' | 'seek' | 'speed') => void) | null = null;
  onFileLoaded: (() => void) | null = null;
  onEof: (() => void) | null = null;

  async init() {
    await mpv.onProp((p) => this.applyProp(p));
    await mpv.onEvent((e) => this.applyEvent(e));
  }

  private applyProp(p: MpvProp) {
    switch (p.name) {
      case 'time-pos':
        if (typeof p.value === 'number') this.position = p.value;
        break;
      case 'duration':
        if (typeof p.value === 'number') this.duration = p.value;
        break;
      case 'pause':
        if (typeof p.value === 'boolean') {
          this.paused = p.value;
          if (p.origin === 'user') this.onUserAction?.(p.value ? 'pause' : 'play');
        }
        break;
      case 'speed':
        if (typeof p.value === 'number') {
          this.speed = p.value;
          if (p.origin === 'user') this.onUserAction?.('speed');
        }
        break;
      case 'path':
        this.path = typeof p.value === 'string' ? p.value : null;
        break;
      case 'eof-reached': {
        const was = this.eof;
        this.eof = p.value === true;
        if (this.eof && !was) this.onEof?.();
        break;
      }
    }
  }

  private applyEvent(e: MpvEvent) {
    switch (e.event) {
      case 'started':
        this.running = true;
        break;
      case 'ipc-closed':
        this.running = false;
        this.path = null;
        break;
      case 'seek':
        if (e.origin === 'user') this.onUserAction?.('seek');
        break;
      case 'file-loaded':
        this.onFileLoaded?.();
        break;
    }
  }
}

export const player = new PlayerStore();
