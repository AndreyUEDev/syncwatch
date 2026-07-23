import type {
  ClientToServer,
  PeerInfo,
  ServerToClient,
  SignalingError,
} from '../../shared/src/protocol';
import { MAX_ROOM_PEERS, PROTOCOL_VERSION } from '../../shared/src/protocol';
import { getIceServers } from './turn';
import type { Env } from './index';

const EMPTY_ROOM_TTL_MS = 10 * 60_000;

interface Attachment {
  phase: 'auth' | 'ready';
  create: boolean;
  code: string;
  peerId?: string;
  name?: string;
}

function randomId(prefix: string, len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

export class Room {
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/probe') {
      const active = (await this.ctx.storage.get('hostId')) !== undefined;
      return new Response(null, { status: active ? 200 : 404 });
    }

    if (url.pathname === '/ws') {
      const pair = new WebSocketPair();
      const attachment: Attachment = {
        phase: 'auth',
        create: url.searchParams.get('create') === '1',
        code: url.searchParams.get('code') ?? '',
      };
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment(attachment);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientToServer;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.fail(ws, 'bad_message');
      return;
    }

    const att = ws.deserializeAttachment() as Attachment;

    if (att.phase === 'auth') {
      if (msg.t !== 'auth') return this.fail(ws, 'bad_message');
      if (msg.ver !== PROTOCOL_VERSION) return this.fail(ws, 'bad_version');
      return att.create ? this.handleCreate(ws, att, msg.name) : this.handleJoin(ws, att, msg);
    }

    switch (msg.t) {
      case 'signal': {
        const target = this.readyPeers().find(([, a]) => a.peerId === msg.to);
        target?.[0].send(
          JSON.stringify({ t: 'signal', from: att.peerId!, data: msg.data } satisfies ServerToClient),
        );
        break;
      }
      case 'leave':
        ws.close(1000, 'bye');
        await this.dropPeer(ws, att);
        break;
      default:
        this.fail(ws, 'bad_message');
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.phase === 'ready') await this.dropPeer(ws, att);
  }

  async webSocketError(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.phase === 'ready') await this.dropPeer(ws, att);
  }

  async alarm() {
    if (this.readyPeers().length === 0) {
      await this.ctx.storage.deleteAll();
    }
  }

  // ---------- вход в комнату ----------

  private async handleCreate(ws: WebSocket, att: Attachment, name: string) {
    const peerId = randomId('p_', 6);
    const resumeToken = randomId('rt_', 16);
    await this.ctx.storage.put({ hostId: peerId, ['rt:' + resumeToken]: peerId });
    await this.ctx.storage.deleteAlarm();

    this.becomeReady(ws, att, peerId, name);
    this.send(ws, {
      t: 'created',
      code: att.code,
      peerId,
      resumeToken,
      turn: await getIceServers(this.env),
    });
  }

  private async handleJoin(
    ws: WebSocket,
    att: Attachment,
    msg: { name: string; resumeToken: string | null },
  ) {
    const hostId = await this.ctx.storage.get<string>('hostId');
    if (hostId === undefined) return this.fail(ws, 'room_not_found');

    let peerId = msg.resumeToken
      ? await this.ctx.storage.get<string>('rt:' + msg.resumeToken)
      : undefined;
    let resumeToken = msg.resumeToken ?? '';

    if (peerId) {
      // Реконнект: старый сокет этого пира закрываем молча, peer_left не шлём.
      for (const [sock, a] of this.readyPeers()) {
        if (a.peerId === peerId && sock !== ws) sock.close(1012, 'resumed elsewhere');
      }
    } else {
      if (this.readyPeers().length >= MAX_ROOM_PEERS) return this.fail(ws, 'room_full');
      peerId = randomId('p_', 6);
      resumeToken = randomId('rt_', 16);
      await this.ctx.storage.put('rt:' + resumeToken, peerId);
    }
    await this.ctx.storage.deleteAlarm();

    const others: PeerInfo[] = this.readyPeers()
      .filter(([sock]) => sock !== ws)
      .map(([, a]) => ({ peerId: a.peerId!, name: a.name! }));

    const isReconnect = others.some((p) => p.peerId === peerId);
    this.becomeReady(ws, att, peerId, msg.name);

    this.send(ws, {
      t: 'joined',
      code: att.code,
      peerId,
      resumeToken,
      hostId,
      peers: others.filter((p) => p.peerId !== peerId),
      turn: await getIceServers(this.env),
    });
    if (!isReconnect) {
      this.broadcast({ t: 'peer_joined', peerId, name: msg.name }, peerId);
    }
  }

  private becomeReady(ws: WebSocket, att: Attachment, peerId: string, name: string) {
    ws.serializeAttachment({ ...att, phase: 'ready', peerId, name } satisfies Attachment);
  }

  private async dropPeer(ws: WebSocket, att: Attachment) {
    // Сокет мог быть уже заменён реконнектом того же пира.
    const stillHere = this.readyPeers().some(
      ([sock, a]) => sock !== ws && a.peerId === att.peerId,
    );
    if (!stillHere) {
      this.broadcast({ t: 'peer_left', peerId: att.peerId! }, att.peerId);

      const hostId = await this.ctx.storage.get<string>('hostId');
      const remaining = this.readyPeers().filter(([sock]) => sock !== ws);
      if (att.peerId === hostId && remaining.length > 0) {
        const newHost = remaining.map(([, a]) => a.peerId!).sort()[0];
        await this.ctx.storage.put('hostId', newHost);
        this.broadcast({ t: 'host_changed', hostId: newHost });
      }
      if (remaining.length === 0) {
        await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
      }
    }
  }

  // ---------- утилиты ----------

  private readyPeers(): [WebSocket, Attachment][] {
    return this.ctx
      .getWebSockets()
      .map((ws) => [ws, ws.deserializeAttachment() as Attachment] as [WebSocket, Attachment])
      .filter(([ws, a]) => a?.phase === 'ready' && ws.readyState === WebSocket.READY_STATE_OPEN);
  }

  private send(ws: WebSocket, msg: ServerToClient) {
    ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerToClient, exceptPeerId?: string) {
    const payload = JSON.stringify(msg);
    for (const [ws, a] of this.readyPeers()) {
      if (a.peerId !== exceptPeerId) ws.send(payload);
    }
  }

  private fail(ws: WebSocket, code: SignalingError) {
    this.send(ws, { t: 'error', code });
    ws.close(1008, code);
  }
}
