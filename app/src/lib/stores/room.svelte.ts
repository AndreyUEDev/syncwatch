import type { FileMeta, PlaylistItem } from '../../../../shared/src/protocol';
import { naturalSort } from '../../../../shared/src/syncmath';
import { Mesh } from '$lib/net/mesh';
import { SyncEngine } from '$lib/sync/engine';
import { mpv } from '$lib/player/mpv';
import { player } from './player.svelte';

const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL ?? 'ws://127.0.0.1:8787';

// OSD-чат поверх видео
const OSD_MAX = 3; // сколько сообщений видно одновременно
const OSD_TTL_MS = 8000; // через сколько сообщение исчезает в тишине
const OSD_BASE_FONT = 'Segoe UI';
const OSD_EMOJI_FONT = 'Segoe UI Emoji';

/**
 * Оборачивает эмодзи (в т.ч. ZWJ-последовательности, тон кожи, VS16) в цветной эмодзи-шрифт.
 * Без этого libass рисует эмодзи дефолтным шрифтом — моно/белыми глифами или «квадратами».
 */
function colorEmoji(s: string): string {
  return s.replace(
    /(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|[️\u{1F3FB}-\u{1F3FF}])*)/gu,
    `{\\fn${OSD_EMOJI_FONT}}$1{\\fn${OSD_BASE_FONT}}`,
  );
}

export interface RoomPeer {
  peerId: string;
  name: string;
  file: FileMeta | null;
  ready: boolean;
  connected: boolean;
}

export interface ChatEntry {
  from: string;
  name: string;
  text: string;
  time: Date;
  system?: boolean;
}

type Phase = 'idle' | 'connecting' | 'in_room' | 'dead';

class RoomStore {
  phase = $state<Phase>('idle');
  code = $state('');
  selfId = $state('');
  hostId = $state('');
  signalOk = $state(true);
  peers = $state<RoomPeer[]>([]);
  chat = $state<ChatEntry[]>([]);
  roomFile = $state<FileMeta | null>(null);
  localFile = $state<FileMeta | null>(null);
  localPath = $state<string | null>(null);
  deadReason = $state('');

  name = $state(localStorage.getItem('syncwatch.name') ?? 'User');
  relayOnly = $state(localStorage.getItem('syncwatch.relayOnly') === '1');
  player = $state<'mpv' | 'vlc'>(
    (localStorage.getItem('syncwatch.player') as 'mpv' | 'vlc') ?? 'mpv',
  );

  playlist = $state<PlaylistItem[]>([]);
  playlistIndex = $state(-1);
  /** Локальное соответствие каждому элементу плейлиста. */
  localMatch = $state<('exact' | 'approx' | 'none')[]>([]);
  peerHave = $state<Record<string, { exact: number[]; approx: number[] }>>({});

  private mesh: Mesh | null = null;
  private engine: SyncEngine | null = null;
  /** Все известные локальные видеофайлы: имя → путь/размер (выбранные + сканы папок). */
  private knownFiles = new Map<string, { path: string; size: number }>();
  private localPaths: (string | null)[] = [];
  private lastFolder = localStorage.getItem('syncwatch.folder') ?? '';
  private osdMessages: { name: string; text: string; ts: number }[] = [];
  private osdTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTitle: string | null = null;

  get isHost() {
    return this.selfId !== '' && this.selfId === this.hostId;
  }

  get fileMismatch(): boolean {
    if (!this.roomFile || !this.localFile || this.isHost) return false;
    return this.roomFile.size !== this.localFile.size || this.roomFile.name !== this.localFile.name;
  }

  create() {
    this.enter((m) => m.create());
  }

  join(code: string) {
    this.enter((m) => m.join(code));
  }

  /** Обработка ссылки syncwatch:// с сайта: создать комнату (с меткой тайтла) или войти. */
  fromDeepLink(a: { kind: 'create' | 'join'; title?: string; code?: string }) {
    if (this.phase === 'in_room' || this.phase === 'connecting') return;
    if (a.kind === 'join' && a.code) {
      this.join(a.code);
    } else if (a.kind === 'create') {
      this.pendingTitle = a.title ?? null;
      this.create();
    }
  }

  setPlayer(kind: 'mpv' | 'vlc') {
    this.player = kind;
    localStorage.setItem('syncwatch.player', kind);
    mpv.setPlayer(kind).catch(() => {});
  }

  private enter(go: (m: Mesh) => void) {
    localStorage.setItem('syncwatch.name', this.name);
    localStorage.setItem('syncwatch.relayOnly', this.relayOnly ? '1' : '0');
    mpv.setPlayer(this.player).catch(() => {});
    this.phase = 'connecting';
    this.chat = [];
    this.peers = [];

    const mesh = new Mesh(
      SIGNAL_URL,
      this.name || 'User',
      {
        onCtrl: (from, msg) => this.engine?.onCtrl(from, msg),
        onTelemetry: (from, msg) => this.engine?.onTelemetry(from, msg),
        onPeerOpen: (peerId, name) => {
          this.upsertPeer(peerId, { name, connected: true });
          this.system(`${name} подключился`);
          this.engine?.onPeerOpen(peerId);
          this.sendHave(peerId);
        },
        onPeerClosed: (peerId) => {
          const p = this.peers.find((x) => x.peerId === peerId);
          if (p?.connected) this.system(`${p.name} отключился`);
          this.peers = this.peers.filter((x) => x.peerId !== peerId);
          this.engine?.onPeerClosed(peerId);
        },
        onRoomEvent: (ev) => {
          switch (ev.kind) {
            case 'ready':
              this.code = ev.code;
              this.selfId = ev.selfId;
              this.hostId = ev.hostId;
              this.phase = 'in_room';
              this.signalOk = true;
              if (this.pendingTitle) {
                this.system(`Смотрим: ${this.pendingTitle}`);
                this.pendingTitle = null;
              }
              break;
            case 'host_changed':
              this.hostId = ev.hostId;
              this.system(`Хост теперь: ${this.mesh?.peerName(ev.hostId) ?? ev.hostId}`);
              break;
            case 'signal_down':
              this.signalOk = false;
              break;
            case 'signal_resumed':
              this.signalOk = true;
              this.hostId = this.mesh?.hostId ?? this.hostId;
              break;
            case 'dead':
              this.phase = 'dead';
              this.deadReason = ev.reason;
              this.engine?.stop();
              break;
          }
        },
      },
      this.relayOnly,
    );

    const engine = new SyncEngine(mesh, {
      onChat: (from, text) => {
        const senderName = from === this.selfId ? this.name || 'User' : mesh.peerName(from);
        this.chat.push({ from, name: senderName, text, time: new Date() });
        this.pushOsd(senderName, text);
      },
      onPeerHello: (peerId, name, file) => this.upsertPeer(peerId, { name, file, connected: true }),
      onPeerFile: (peerId, file) => this.upsertPeer(peerId, { file }),
      onPeerReady: (peerId, ready) => this.upsertPeer(peerId, { ready }),
      onRoomFile: (file) => {
        this.roomFile = file;
      },
      onRemotePause: () => {},
      onPlaylist: (items, index, indexChanged, locally) =>
        this.applyPlaylist(items, index, indexChanged, locally),
      onPeerHave: (peerId, exact, approx) => {
        this.peerHave = { ...this.peerHave, [peerId]: { exact, approx } };
      },
    }, this.name || 'User');

    engine.localFile = this.localFile;
    this.mesh = mesh;
    this.engine = engine;
    engine.start();
    go(mesh);
  }

  leave() {
    this.engine?.stop();
    this.mesh?.leave();
    this.mesh = null;
    this.engine = null;
    this.phase = 'idle';
    this.code = '';
    this.selfId = '';
    this.peers = [];
  }

  // ---------- плейлист ----------

  /** Добавить файлы в плейлист комнаты (natural sort внутри пачки). */
  async addFiles(paths: string[]) {
    const batch: PlaylistItem[] = [];
    for (const path of paths) {
      const info = await mpv.probeFile(path);
      this.knownFiles.set(info.name, { path, size: info.size });
      batch.push({ name: info.name, size: info.size, duration: 0 });
    }
    const parent = paths[0]?.replace(/[\\/][^\\/]*$/, '');
    if (parent) this.rememberFolder(parent);
    this.appendToPlaylist(batch);
  }

  /** Добавить все видео из папки по порядку. */
  async addFolder(dir: string) {
    const entries = await mpv.listVideos(dir);
    if (entries.length === 0) return;
    this.rememberFolder(dir);
    for (const e of entries) this.knownFiles.set(e.name, { path: e.path, size: e.size });
    this.appendToPlaylist(entries.map((e) => ({ name: e.name, size: e.size, duration: 0 })));
  }

  /** Переключить серию у всех. */
  selectEpisode(index: number) {
    if (index < 0 || index >= this.playlist.length) return;
    this.engine?.setPlaylist([...this.playlist], index);
  }

  /** EOF у хоста → автопереход на следующую серию (на паузе). */
  eofReached() {
    if (!this.isHost || !this.engine) return;
    const next = this.playlistIndex + 1;
    if (next < this.playlist.length) {
      setTimeout(() => this.engine?.setPlaylist([...this.playlist], next), 1500);
    }
  }

  private appendToPlaylist(rawBatch: PlaylistItem[]) {
    const batch = naturalSort(rawBatch);
    const existing = new Set(this.playlist.map((i) => i.name));
    const items = [...this.playlist, ...batch.filter((i) => !existing.has(i.name))];
    if (items.length === 0) return;
    const index = this.playlistIndex === -1 ? 0 : this.playlistIndex;
    this.engine?.setPlaylist(items, index);
  }

  private async applyPlaylist(
    items: PlaylistItem[],
    index: number,
    indexChanged: boolean,
    locally: boolean,
  ) {
    const hadIndex = this.playlistIndex;
    this.playlist = items;
    this.playlistIndex = index;
    if (!locally) this.system('Плейлист комнаты обновлён');

    await this.rematch();
    this.sendHave();

    if ((indexChanged || hadIndex === -1) && index >= 0) {
      const path = this.localPaths[index];
      if (path) {
        await this.loadLocal(path, items[index].name);
      } else {
        this.system(`Нет файла «${items[index].name}» — выбери папку с сериями`);
      }
    }
  }

  /** Сопоставить плейлист с локальными файлами; при пробелах — досканировать последнюю папку. */
  private async rematch() {
    const missing = this.playlist.some((i) => !this.knownFiles.has(i.name));
    if (missing && this.lastFolder) {
      try {
        for (const e of await mpv.listVideos(this.lastFolder)) {
          if (!this.knownFiles.has(e.name)) this.knownFiles.set(e.name, { path: e.path, size: e.size });
        }
      } catch {
        // папка могла исчезнуть — не страшно
      }
    }
    this.localPaths = this.playlist.map((i) => this.knownFiles.get(i.name)?.path ?? null);
    this.localMatch = this.playlist.map((i) => {
      const known = this.knownFiles.get(i.name);
      if (!known) return 'none';
      return known.size === i.size ? 'exact' : 'approx';
    });
  }

  private sendHave(to?: string) {
    if (!this.engine) return;
    const exact: number[] = [];
    const approx: number[] = [];
    this.localMatch.forEach((m, i) => {
      if (m === 'exact') exact.push(i);
      else if (m === 'approx') approx.push(i);
    });
    this.engine.broadcastHave(exact, approx, to);
  }

  /** Сколько участников (включая себя) имеют элемент i и есть ли расхождения. */
  itemAvailability(i: number): { have: number; total: number; mismatch: boolean } {
    let have = 0;
    let mismatch = false;
    if (this.localMatch[i] === 'exact') have += 1;
    else if (this.localMatch[i] === 'approx') {
      have += 1;
      mismatch = true;
    }
    for (const p of this.peers) {
      const h = this.peerHave[p.peerId];
      if (!h) continue;
      if (h.exact.includes(i)) have += 1;
      else if (h.approx.includes(i)) {
        have += 1;
        mismatch = true;
      }
    }
    const total = this.peers.length + 1;
    if (have < total) mismatch = true;
    return { have, total, mismatch };
  }

  private rememberFolder(dir: string) {
    this.lastFolder = dir;
    localStorage.setItem('syncwatch.folder', dir);
  }

  private async loadLocal(path: string, name: string) {
    await mpv.load(path);
    this.localPath = path;
    const known = this.knownFiles.get(name);
    this.localFile = { name, size: known?.size ?? 0, duration: 0 };
    this.engine?.setLocalFile(this.localFile);
    if (this.isHost) this.roomFile = this.localFile;
  }

  // ---------- OSD-чат поверх mpv ----------

  private pushOsd(name: string, text: string) {
    this.osdMessages.push({ name, text, ts: Date.now() });
    this.renderOsd();
  }

  private renderOsd() {
    if (this.osdTimer) clearTimeout(this.osdTimer);
    const now = Date.now();
    this.osdMessages = this.osdMessages.filter((m) => now - m.ts < OSD_TTL_MS).slice(-OSD_MAX);

    if (this.osdMessages.length === 0 || !player.running) {
      mpv.osd('').catch(() => {});
      return;
    }
    // Убираем ASS-управляющие символы из пользовательского текста, потом красим эмодзи.
    const esc = (s: string) => s.replace(/[{}\\]/g, '').replace(/\n/g, ' ');
    const fmt = (s: string) => colorEmoji(esc(s));
    const lines = this.osdMessages
      .map((m) => `{\\b1}${fmt(m.name)}:{\\b0} ${fmt(m.text)}`)
      .join('\\N');
    mpv
      .osd(`{\\an7}{\\fn${OSD_BASE_FONT}}{\\fs26}{\\bord1.5}{\\shad0.5}${lines}`)
      .catch(() => {});
    this.osdTimer = setTimeout(() => this.renderOsd(), 1000);
  }

  // ---------- проброс действий ----------

  updateLocalDuration(duration: number) {
    if (this.localFile && this.localFile.duration !== duration) {
      this.localFile = { ...this.localFile, duration };
      this.engine?.setLocalFile(this.localFile);
    }
  }

  togglePause() {
    this.engine?.localAction(player.paused ? 'play' : 'pause');
  }

  seek(pos: number) {
    this.engine?.localAction('seek', { pos });
  }

  setSpeed(speed: number) {
    this.engine?.localAction('speed', { speed });
  }

  userActionFromMpv(kind: 'play' | 'pause' | 'seek' | 'speed') {
    this.engine?.localAction(kind, { fromMpv: true, speed: player.speed });
  }

  /** Свежезагруженный файл встаёт в текущее состояние комнаты, а не автоиграет. */
  fileLoaded() {
    this.engine?.syncToRoom();
  }

  sendChat(text: string) {
    this.engine?.sendChat(text);
  }

  private upsertPeer(peerId: string, patch: Partial<RoomPeer>) {
    const existing = this.peers.find((p) => p.peerId === peerId);
    if (existing) {
      Object.assign(existing, patch);
      this.peers = [...this.peers];
    } else {
      this.peers = [
        ...this.peers,
        { peerId, name: peerId, file: null, ready: false, connected: false, ...patch },
      ];
    }
  }

  private system(text: string) {
    this.chat.push({ from: '', name: '', text, time: new Date(), system: true });
  }
}

export const room = new RoomStore();
