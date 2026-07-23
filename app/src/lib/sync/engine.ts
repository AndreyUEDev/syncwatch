import type {
  ActionKind,
  CtrlMessage,
  FileMeta,
  PlaylistItem,
  TelemetryMessage,
} from '../../../../shared/src/protocol';
import {
  CATCHUP_SPEED_FACTOR,
  CLOCK_PING_INTERVAL_MS,
  DRIFT_DEADZONE_S,
  DRIFT_SEEK_THRESHOLD_S,
  PROTOCOL_VERSION,
  SLOWDOWN_SPEED_FACTOR,
  STATE_REPORT_INTERVAL_MS,
} from '../../../../shared/src/protocol';
import { actionWins, driftDecision } from '../../../../shared/src/syncmath';
import type { Mesh } from '$lib/net/mesh';
import { mpv } from '$lib/player/mpv';
import { PeerClock } from './clock';

export interface EngineCallbacks {
  onChat: (from: string, text: string, tSent: number) => void;
  onPeerHello: (peerId: string, name: string, file: FileMeta | null) => void;
  onPeerFile: (peerId: string, file: FileMeta | null) => void;
  onPeerReady: (peerId: string, ready: boolean) => void;
  onRoomFile: (file: FileMeta | null) => void;
  /** Хост поставил паузу при входе новичка и т.п. — для баннеров UI. */
  onRemotePause: (actorName: string) => void;
  /** Плейлист комнаты обновился (locally=true — это наше собственное изменение). */
  onPlaylist: (items: PlaylistItem[], index: number, indexChanged: boolean, locally: boolean) => void;
  onPeerHave: (peerId: string, exact: number[], approx: number[]) => void;
}

interface RoomPlayback {
  paused: boolean;
  pos: number;
  speed: number;
  /** performance.now() момента, которому соответствует pos (локальные часы). */
  at: number;
}

/**
 * Sync-движок: last-action-wins поверх Lamport seq, компенсация RTT,
 * дрейф-коррекция к позиции хоста. Хост никогда не подстраивается сам.
 */
export class SyncEngine {
  private seq = 0;
  private lastApplied: { seq: number; actorId: string } = { seq: 0, actorId: '' };
  private clocks = new Map<string, PeerClock>();
  private pingId = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private room: RoomPlayback = { paused: true, pos: 0, speed: 1, at: 0 };
  private correcting = false;

  localFile: FileMeta | null = null;
  pauseOnJoin = true;

  playlist: PlaylistItem[] = [];
  playlistIndex = -1;
  private lastPlaylist: { seq: number; actorId: string } = { seq: 0, actorId: '' };

  constructor(
    private mesh: Mesh,
    private cb: EngineCallbacks,
    private selfName: string,
  ) {}

  get isHost(): boolean {
    return this.mesh.hostId === this.mesh.selfId;
  }

  start() {
    this.timers.push(
      setInterval(() => this.broadcastStateReport(), STATE_REPORT_INTERVAL_MS),
      setInterval(() => this.pingAll(), CLOCK_PING_INTERVAL_MS),
      setInterval(() => this.correctDrift(), STATE_REPORT_INTERVAL_MS),
    );
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ---------- исходящее ----------

  /** Действие юзера (UI или хоткей в mpv). Локально уже применено, если fromMpv. */
  async localAction(kind: ActionKind, opts: { fromMpv?: boolean; pos?: number; speed?: number } = {}) {
    const pos = opts.pos ?? (await mpv.getPosition()) ?? 0;
    const speed = opts.speed ?? this.room.speed;
    const paused = kind === 'pause' ? true : kind === 'play' ? false : this.room.paused;

    this.seq += 1;
    this.lastApplied = { seq: this.seq, actorId: this.mesh.selfId };
    this.room = { paused, pos, speed, at: performance.now() };

    if (!opts.fromMpv) {
      if (kind === 'play') await mpv.setPause(false);
      if (kind === 'pause') await mpv.setPause(true);
      if (kind === 'seek') await mpv.seek(pos);
      if (kind === 'speed') await mpv.setSpeed(speed);
    }

    this.mesh.broadcastCtrl({
      t: 'action',
      seq: this.seq,
      actorId: this.mesh.selfId,
      kind,
      pos,
      speed,
      tSent: performance.now(),
    });
  }

  /** После загрузки файла подстроиться под текущее состояние комнаты. */
  async syncToRoom() {
    const { paused, pos, speed, at } = this.room;
    if (at === 0) {
      await mpv.setPause(true);
      return;
    }
    const target = paused ? pos : pos + ((performance.now() - at) / 1000) * speed;
    await mpv.setSpeed(speed);
    await mpv.seek(Math.max(0, target));
    await mpv.setPause(paused);
  }

  /** Заменить/дополнить плейлист комнаты и/или переключить серию. */
  setPlaylist(items: PlaylistItem[], index: number) {
    const indexChanged = index !== this.playlistIndex;
    this.seq += 1;
    this.lastPlaylist = { seq: this.seq, actorId: this.mesh.selfId };
    this.playlist = items;
    this.playlistIndex = index;
    if (indexChanged) {
      // смена серии = все на паузе в начале нового файла
      this.room = { paused: true, pos: 0, speed: this.room.speed, at: performance.now() };
    }
    this.mesh.broadcastCtrl({
      t: 'playlist',
      seq: this.seq,
      actorId: this.mesh.selfId,
      items,
      index,
    });
    this.cb.onPlaylist(items, index, indexChanged, true);
  }

  broadcastHave(exact: number[], approx: number[], to?: string) {
    const msg: CtrlMessage = { t: 'have', exact, approx };
    if (to) this.mesh.sendCtrl(to, msg);
    else this.mesh.broadcastCtrl(msg);
  }

  sendChat(text: string) {
    const msg: CtrlMessage = {
      t: 'chat',
      msgId: crypto.randomUUID(),
      from: this.mesh.selfId,
      text,
      tSent: performance.now(),
    };
    this.mesh.broadcastCtrl(msg);
    this.cb.onChat(this.mesh.selfId, text, msg.tSent);
  }

  setLocalFile(file: FileMeta | null) {
    this.localFile = file;
    this.mesh.broadcastCtrl({ t: 'file', file });
    if (this.isHost) this.cb.onRoomFile(file);
  }

  /** Новый P2P-канал открыт: представиться; хост дополнительно шлёт room_state. */
  async onPeerOpen(peerId: string) {
    this.clocks.set(peerId, new PeerClock());
    this.mesh.sendCtrl(peerId, {
      t: 'hello',
      peerId: this.mesh.selfId,
      name: this.selfName,
      ver: PROTOCOL_VERSION,
      file: this.localFile,
    });
    this.pingPeer(peerId);

    if (this.isHost) {
      if (this.pauseOnJoin && !this.room.paused) {
        await this.localAction('pause');
        this.cb.onRemotePause(this.selfName);
      }
      await this.sendRoomState(peerId);
      if (this.playlist.length > 0) {
        this.mesh.sendCtrl(peerId, {
          t: 'playlist',
          seq: this.lastPlaylist.seq,
          actorId: this.lastPlaylist.actorId,
          items: this.playlist,
          index: this.playlistIndex,
        });
      }
    }
  }

  onPeerClosed(peerId: string) {
    this.clocks.delete(peerId);
  }

  // ---------- входящее ----------

  async onCtrl(from: string, msg: CtrlMessage) {
    switch (msg.t) {
      case 'hello':
        this.cb.onPeerHello(from, msg.name, msg.file);
        break;

      case 'file':
        this.cb.onPeerFile(from, msg.file);
        break;

      case 'ready':
        this.cb.onPeerReady(from, msg.ready);
        break;

      case 'chat':
        this.cb.onChat(from, msg.text, msg.tSent);
        break;

      case 'clock_ping':
        this.mesh.sendCtrl(from, {
          t: 'clock_pong',
          id: msg.id,
          tSent: msg.tSent,
          tRecv: performance.now(),
        });
        break;

      case 'clock_pong':
        this.clocks.get(from)?.addSample(msg.tSent, msg.tRecv, performance.now());
        break;

      case 'action':
        await this.applyAction(from, msg);
        break;

      case 'playlist': {
        const newer =
          msg.seq > this.lastPlaylist.seq ||
          (msg.seq === this.lastPlaylist.seq && msg.actorId > this.lastPlaylist.actorId);
        this.seq = Math.max(this.seq, msg.seq);
        if (!newer) break;
        this.lastPlaylist = { seq: msg.seq, actorId: msg.actorId };
        const indexChanged = msg.index !== this.playlistIndex;
        this.playlist = msg.items;
        this.playlistIndex = msg.index;
        if (indexChanged) {
          this.room = { paused: true, pos: 0, speed: this.room.speed, at: performance.now() };
        }
        this.cb.onPlaylist(msg.items, msg.index, indexChanged, false);
        break;
      }

      case 'have':
        this.cb.onPeerHave(from, msg.exact, msg.approx);
        break;

      case 'room_state': {
        // авторитетный снапшот: затирает всё локальное
        this.lastApplied = { seq: msg.seq, actorId: msg.hostId };
        this.seq = Math.max(this.seq, msg.seq);
        this.cb.onRoomFile(msg.file);
        const pos = msg.paused ? msg.pos : msg.pos + this.elapsedSince(from, msg.tSent) * msg.speed;
        this.room = { paused: msg.paused, pos, speed: msg.speed, at: performance.now() };
        await mpv.setSpeed(msg.speed);
        await mpv.seek(Math.max(0, pos));
        await mpv.setPause(msg.paused);
        break;
      }
    }
  }

  onTelemetry(from: string, msg: TelemetryMessage) {
    // интересует только телеметрия хоста — она эталон для дрейфа
    if (from !== this.mesh.hostId || this.isHost) return;
    const pos = msg.paused ? msg.pos : msg.pos + this.elapsedSince(from, msg.tSent) * msg.speed;
    this.room = { paused: msg.paused, pos, speed: msg.speed, at: performance.now() };
  }

  // ---------- внутренности ----------

  private async applyAction(from: string, msg: Extract<CtrlMessage, { t: 'action' }>) {
    const newer = actionWins(msg, this.lastApplied);
    this.seq = Math.max(this.seq, msg.seq);
    if (!newer) return;
    this.lastApplied = { seq: msg.seq, actorId: msg.actorId };

    const paused = msg.kind === 'pause' ? true : msg.kind === 'play' ? false : this.room.paused;
    const pos = paused ? msg.pos : msg.pos + this.elapsedSince(from, msg.tSent) * msg.speed;
    this.room = { paused, pos, speed: msg.speed, at: performance.now() };

    switch (msg.kind) {
      case 'pause':
        await mpv.setPause(true);
        await mpv.seek(Math.max(0, msg.pos));
        this.cb.onRemotePause(this.mesh.peerName(from));
        break;
      case 'play':
        await mpv.seek(Math.max(0, pos));
        await mpv.setPause(false);
        break;
      case 'seek':
        await mpv.seek(Math.max(0, pos));
        break;
      case 'speed':
        await mpv.setSpeed(msg.speed);
        break;
    }
  }

  private async sendRoomState(to: string) {
    const pos = (await mpv.getPosition()) ?? this.room.pos;
    this.mesh.sendCtrl(to, {
      t: 'room_state',
      seq: this.seq,
      hostId: this.mesh.hostId,
      file: this.localFile,
      paused: this.room.paused,
      pos,
      speed: this.room.speed,
      tSent: performance.now(),
      peers: [],
    });
  }

  private async broadcastStateReport() {
    const pos = await mpv.getPosition();
    if (pos === null) return;
    this.mesh.broadcastTelemetry({
      t: 'state_report',
      pos,
      paused: this.room.paused,
      speed: this.room.speed,
      tSent: performance.now(),
    });
  }

  /** Дрейф-коррекция не-хоста: тянемся к экстраполированной позиции хоста. */
  private async correctDrift() {
    if (this.isHost || this.room.paused || this.room.at === 0) return;

    const myPos = await mpv.getPosition();
    if (myPos === null) return;

    const expected = this.room.pos + ((performance.now() - this.room.at) / 1000) * this.room.speed;
    const drift = myPos - expected;

    if (Math.abs(drift) >= DRIFT_SEEK_THRESHOLD_S) {
      await mpv.seek(Math.max(0, expected));
      if (this.correcting) {
        await mpv.setSpeed(this.room.speed);
        this.correcting = false;
      }
    } else if (Math.abs(drift) > DRIFT_DEADZONE_S) {
      this.correcting = true;
      const factor = drift < 0 ? CATCHUP_SPEED_FACTOR : SLOWDOWN_SPEED_FACTOR;
      await mpv.setSpeed(this.room.speed * factor);
    } else if (this.correcting) {
      await mpv.setSpeed(this.room.speed);
      this.correcting = false;
    }
  }

  /** Сколько секунд прошло с tSent пира (его часы) по нашим часам. */
  private elapsedSince(peerId: string, tSentPeer: number): number {
    const clock = this.clocks.get(peerId);
    if (!clock?.ready) return 0;
    const sentLocal = tSentPeer - clock.offset;
    return Math.max(0, (performance.now() - sentLocal) / 1000);
  }

  private pingAll() {
    for (const id of this.mesh.connectedPeerIds) this.pingPeer(id, 1);
  }

  private pingPeer(peerId: string, burst = 5) {
    for (let i = 0; i < burst; i++) {
      setTimeout(() => {
        this.pingId += 1;
        this.mesh.sendCtrl(peerId, { t: 'clock_ping', id: this.pingId, tSent: performance.now() });
      }, i * 200);
    }
  }
}
