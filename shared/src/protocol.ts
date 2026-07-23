// Общие типы протокола Syncwatch: сигналинг (клиент <-> Worker) и sync (пир <-> пир).

export const PROTOCOL_VERSION = 1;

// ---------- Сигналинг ----------

export interface PeerInfo {
  peerId: string;
  name: string;
}

/** Структурная копия RTCIceServer/RTCIceCandidateInit — файл компилируется и без DOM-типов (Worker). */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface IceServersConfig {
  iceServers: IceServer[];
}

/**
 * Подключение: WS на /ws/new (создание) или /ws/{code} (вход),
 * первым сообщением клиент шлёт auth.
 */
export type ClientToServer =
  | { t: 'auth'; name: string; resumeToken: string | null; ver: number }
  | { t: 'signal'; to: string; data: SignalData }
  | { t: 'leave' };

export type SignalData =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: IceCandidate };

export type ServerToClient =
  | { t: 'created'; code: string; peerId: string; resumeToken: string; turn: IceServersConfig }
  | {
      t: 'joined';
      code: string;
      peerId: string;
      resumeToken: string;
      hostId: string;
      peers: PeerInfo[];
      turn: IceServersConfig;
    }
  | { t: 'peer_joined'; peerId: string; name: string }
  | { t: 'peer_left'; peerId: string }
  | { t: 'host_changed'; hostId: string }
  | { t: 'signal'; from: string; data: SignalData }
  | { t: 'error'; code: SignalingError };

export type SignalingError =
  | 'room_not_found'
  | 'room_full'
  | 'bad_message'
  | 'bad_version'
  | 'auth_timeout';

// ---------- P2P sync (data channels) ----------

export interface FileMeta {
  name: string;
  size: number;
  duration: number;
}

export type ActionKind = 'play' | 'pause' | 'seek' | 'speed';

/** Элемент плейлиста — метаданные файла, по которым каждый ищет свою локальную копию. */
export interface PlaylistItem {
  name: string;
  size: number;
  duration: number;
}

/** Канал ctrl: reliable + ordered. */
export type CtrlMessage =
  | { t: 'hello'; peerId: string; name: string; ver: number; file: FileMeta | null }
  | {
      t: 'action';
      seq: number;
      actorId: string;
      kind: ActionKind;
      pos: number;
      speed: number;
      tSent: number;
    }
  | {
      t: 'room_state';
      seq: number;
      hostId: string;
      file: FileMeta | null;
      paused: boolean;
      pos: number;
      speed: number;
      tSent: number;
      peers: { peerId: string; name: string; ready: boolean }[];
    }
  | { t: 'chat'; msgId: string; from: string; text: string; tSent: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'file'; file: FileMeta | null }
  | {
      /** Авторитетный снапшот плейлиста комнаты: список серий + текущий индекс. Last-wins по (seq, actorId). */
      t: 'playlist';
      seq: number;
      actorId: string;
      items: PlaylistItem[];
      index: number;
    }
  | {
      /** Какие элементы плейлиста есть у отправителя: exact — имя+размер, approx — имя совпало, размер нет. */
      t: 'have';
      exact: number[];
      approx: number[];
    }
  | { t: 'clock_ping'; id: number; tSent: number }
  | { t: 'clock_pong'; id: number; tSent: number; tRecv: number };

/** Канал telemetry: unordered, maxRetransmits 0. */
export type TelemetryMessage = {
  t: 'state_report';
  pos: number;
  paused: boolean;
  speed: number;
  tSent: number;
};

// ---------- Константы sync-движка ----------

export const DRIFT_DEADZONE_S = 0.1;
export const DRIFT_SEEK_THRESHOLD_S = 2.5;
export const CATCHUP_SPEED_FACTOR = 1.05;
export const SLOWDOWN_SPEED_FACTOR = 0.95;
export const STATE_REPORT_INTERVAL_MS = 1000;
export const CLOCK_PING_INTERVAL_MS = 10_000;
export const CLOCK_SAMPLES = 8;
export const MAX_ROOM_PEERS = 10;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
