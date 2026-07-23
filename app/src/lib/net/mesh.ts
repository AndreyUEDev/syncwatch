import type {
  CtrlMessage,
  IceServersConfig,
  ServerToClient,
  SignalData,
  TelemetryMessage,
} from '../../../../shared/src/protocol';
import { Peer } from './peer';
import { Signaling, type SignalingCallbacks } from './signaling';

export interface MeshCallbacks {
  onCtrl: (from: string, msg: CtrlMessage) => void;
  onTelemetry: (from: string, msg: TelemetryMessage) => void;
  onPeerOpen: (peerId: string, name: string) => void;
  onPeerClosed: (peerId: string) => void;
  onRoomEvent: (ev: RoomEvent) => void;
}

export type RoomEvent =
  | { kind: 'ready'; code: string; selfId: string; hostId: string }
  | { kind: 'host_changed'; hostId: string }
  | { kind: 'signal_down' }
  | { kind: 'signal_resumed' }
  | { kind: 'dead'; reason: string };

/** Full mesh комнаты поверх сигналки: сам поднимает Peer'ов и раздаёт сообщения. */
export class Mesh {
  private signaling: Signaling;
  private peers = new Map<string, Peer>();
  private names = new Map<string, string>();
  private ice: IceServersConfig = { iceServers: [] };
  hostId = '';

  constructor(
    baseUrl: string,
    private name: string,
    private cb: MeshCallbacks,
    private relayOnly = false,
  ) {
    const scb: SignalingCallbacks = {
      onMessage: (msg) => this.handleSignaling(msg),
      onDown: () => cb.onRoomEvent({ kind: 'signal_down' }),
      onResumed: () => cb.onRoomEvent({ kind: 'signal_resumed' }),
      onDead: (reason) => cb.onRoomEvent({ kind: 'dead', reason }),
    };
    this.signaling = new Signaling(baseUrl, name, scb);
  }

  create() {
    this.signaling.connect('new');
  }

  join(code: string) {
    this.signaling.connect(code.trim().toUpperCase());
  }

  leave() {
    this.signaling.leave();
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
  }

  get selfId() {
    return this.signaling.peerId;
  }

  peerName(peerId: string) {
    return this.names.get(peerId) ?? peerId;
  }

  get connectedPeerIds(): string[] {
    return [...this.peers.entries()].filter(([, p]) => p.connected).map(([id]) => id);
  }

  broadcastCtrl(msg: CtrlMessage) {
    for (const p of this.peers.values()) p.sendCtrl(msg);
  }

  sendCtrl(peerId: string, msg: CtrlMessage) {
    this.peers.get(peerId)?.sendCtrl(msg);
  }

  broadcastTelemetry(msg: TelemetryMessage) {
    for (const p of this.peers.values()) p.sendTelemetry(msg);
  }

  async peerStats(peerId: string) {
    return this.peers.get(peerId)?.stats();
  }

  private handleSignaling(msg: ServerToClient) {
    switch (msg.t) {
      case 'created':
        this.hostId = msg.peerId;
        this.ice = msg.turn;
        this.cb.onRoomEvent({ kind: 'ready', code: msg.code, selfId: msg.peerId, hostId: msg.peerId });
        break;

      case 'joined':
        this.hostId = msg.hostId;
        this.ice = msg.turn;
        // новичок — offerer ко всем существующим
        for (const p of msg.peers) {
          this.names.set(p.peerId, p.name);
          this.ensurePeer(p.peerId, true);
        }
        this.cb.onRoomEvent({ kind: 'ready', code: msg.code, selfId: msg.peerId, hostId: msg.hostId });
        break;

      case 'peer_joined':
        this.names.set(msg.peerId, msg.name);
        // его offer придёт через сигналку — Peer создастся на первом signal
        break;

      case 'peer_left':
        this.peers.get(msg.peerId)?.close();
        this.peers.delete(msg.peerId);
        break;

      case 'host_changed':
        this.hostId = msg.hostId;
        this.cb.onRoomEvent({ kind: 'host_changed', hostId: msg.hostId });
        break;

      case 'signal':
        this.ensurePeer(msg.from, false).handleSignal(msg.data);
        break;

      case 'error':
        this.cb.onRoomEvent({ kind: 'dead', reason: msg.code });
        break;
    }
  }

  private ensurePeer(peerId: string, offerer: boolean): Peer {
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = new Peer(
        peerId,
        this.ice,
        offerer,
        {
          sendSignal: (to: string, data: SignalData) => this.signaling.send({ t: 'signal', to, data }),
          onCtrl: (from, m) => this.cb.onCtrl(from, m),
          onTelemetry: (from, m) => this.cb.onTelemetry(from, m),
          onOpen: (id) => this.cb.onPeerOpen(id, this.peerName(id)),
          onClosed: (id) => this.cb.onPeerClosed(id),
        },
        this.relayOnly,
      );
      this.peers.set(peerId, peer);
    }
    return peer;
  }
}
