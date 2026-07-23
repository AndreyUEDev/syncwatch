import type { ClientToServer, ServerToClient } from '../../../../shared/src/protocol';
import { PROTOCOL_VERSION } from '../../../../shared/src/protocol';

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

export interface SignalingCallbacks {
  onMessage: (msg: ServerToClient) => void;
  /** Обрыв WS: идёт авто-реконнект с resumeToken. */
  onDown: () => void;
  /** WS восстановлен и комната переподтверждена (joined уже доставлен в onMessage). */
  onResumed: () => void;
  /** Реконнект невозможен (комната умерла, несовместимая версия). */
  onDead: (reason: string) => void;
}

export class Signaling {
  private ws: WebSocket | null = null;
  private closed = false;
  private backoff = BACKOFF_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  code = '';
  peerId = '';
  resumeToken: string | null = null;

  constructor(
    private baseUrl: string,
    private name: string,
    private cb: SignalingCallbacks,
  ) {}

  /** Первое подключение: codeOrNew = 'new' или код комнаты. */
  connect(codeOrNew: string) {
    this.code = codeOrNew === 'new' ? '' : codeOrNew;
    this.open(codeOrNew);
  }

  send(msg: ClientToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  leave() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.send({ t: 'leave' });
    this.ws?.close(1000);
    this.ws = null;
  }

  private open(codeOrNew: string) {
    const isResume = this.resumeToken !== null && codeOrNew !== 'new';
    const ws = new WebSocket(`${this.baseUrl}/ws/${codeOrNew}`);
    this.ws = ws;

    ws.onopen = () => {
      this.send({ t: 'auth', name: this.name, resumeToken: this.resumeToken, ver: PROTOCOL_VERSION });
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as ServerToClient;

      if (msg.t === 'created' || msg.t === 'joined') {
        this.code = msg.code;
        this.peerId = msg.peerId;
        this.resumeToken = msg.resumeToken;
        this.backoff = BACKOFF_MIN_MS;
        this.cb.onMessage(msg);
        if (isResume) this.cb.onResumed();
        return;
      }
      if (msg.t === 'error' && (msg.code === 'room_not_found' || msg.code === 'bad_version')) {
        this.closed = true;
        this.cb.onDead(msg.code);
        return;
      }
      this.cb.onMessage(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      this.ws = null;
      this.cb.onDown();
      this.reconnectTimer = setTimeout(() => this.open(this.code), this.backoff);
      this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
    };
  }
}
