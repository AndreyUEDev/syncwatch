import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type PropOrigin = 'own' | 'user' | 'init';

export interface MpvProp {
  name: string;
  value: unknown;
  /** только для pause/speed и прочих дискретных свойств; у time-pos нет */
  origin?: PropOrigin;
}

export interface MpvEvent {
  event: string;
  origin?: PropOrigin;
}

export interface FileInfo {
  name: string;
  size: number;
}

export interface DirEntry {
  name: string;
  size: number;
  path: string;
}

export type PlayerKind = 'mpv' | 'vlc';

/** Обёртка над командами выбранного плеера (mpv или VLC). События идут в те же каналы. */
export const mpv = {
  setPlayer: (kind: PlayerKind) => invoke<void>('set_player', { kind }),
  start: () => invoke<void>('player_start'),
  load: (path: string) => invoke<void>('player_load', { path }),
  setPause: (paused: boolean) => invoke<void>('player_set_pause', { paused }),
  seek: (pos: number) => invoke<void>('player_seek', { pos }),
  setSpeed: (speed: number) => invoke<void>('player_set_speed', { speed }),
  getPosition: () => invoke<number | null>('player_get_position'),
  stop: () => invoke<void>('player_stop'),
  osd: (data: string) => invoke<void>('player_osd', { data }),
  probeFile: (path: string) => invoke<FileInfo>('probe_file', { path }),
  listVideos: (dir: string) => invoke<DirEntry[]>('list_videos', { dir }),

  onProp: (cb: (p: MpvProp) => void): Promise<UnlistenFn> =>
    listen<MpvProp>('mpv://prop', (e) => cb(e.payload)),
  onEvent: (cb: (e: MpvEvent) => void): Promise<UnlistenFn> =>
    listen<MpvEvent>('mpv://event', (e) => cb(e.payload)),
};
