import type {
  CtrlMessage,
  IceServersConfig,
  SignalData,
  TelemetryMessage,
} from '../../../../shared/src/protocol';

export interface PeerCallbacks {
  sendSignal: (to: string, data: SignalData) => void;
  onCtrl: (from: string, msg: CtrlMessage) => void;
  onTelemetry: (from: string, msg: TelemetryMessage) => void;
  onOpen: (peerId: string) => void;
  onClosed: (peerId: string) => void;
}

/** Одно WebRTC-соединение с участником комнаты: каналы ctrl + telemetry. */
export class Peer {
  private pc: RTCPeerConnection;
  private ctrl: RTCDataChannel | null = null;
  private telemetry: RTCDataChannel | null = null;
  private makingOffer = false;
  private opened = false;
  private iceQueue: RTCIceCandidateInit[] = [];

  constructor(
    readonly peerId: string,
    ice: IceServersConfig,
    private readonly offerer: boolean,
    private cb: PeerCallbacks,
    relayOnly = false,
  ) {
    this.pc = new RTCPeerConnection({
      iceServers: ice.iceServers as RTCIceServer[],
      iceTransportPolicy: relayOnly ? 'relay' : 'all',
    });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) cb.sendSignal(peerId, { type: 'ice', candidate: e.candidate.toJSON() });
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        cb.sendSignal(peerId, { type: 'offer', sdp: this.pc.localDescription!.sdp });
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed') this.restartIce();
      if (s === 'closed') this.cb.onClosed(peerId);
    };

    if (offerer) {
      this.attachCtrl(this.pc.createDataChannel('ctrl'));
      this.attachTelemetry(this.pc.createDataChannel('telemetry', { ordered: false, maxRetransmits: 0 }));
    } else {
      this.pc.ondatachannel = (e) => {
        if (e.channel.label === 'ctrl') this.attachCtrl(e.channel);
        else if (e.channel.label === 'telemetry') this.attachTelemetry(e.channel);
      };
    }
  }

  async handleSignal(data: SignalData) {
    switch (data.type) {
      case 'offer': {
        // glare: новичок всегда offerer, но после ICE restart роли могут столкнуться —
        // уступает (polite) сторона, принявшая соединение изначально.
        if (this.makingOffer || this.pc.signalingState !== 'stable') {
          if (this.offerer) return; // impolite отбрасывает чужой offer
          await Promise.all([
            this.pc.setLocalDescription({ type: 'rollback' }),
            this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp }),
          ]);
        } else {
          await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        }
        this.flushIceQueue();
        await this.pc.setLocalDescription();
        this.cb.sendSignal(this.peerId, { type: 'answer', sdp: this.pc.localDescription!.sdp });
        break;
      }
      case 'answer':
        await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        this.flushIceQueue();
        break;
      case 'ice':
        if (this.pc.remoteDescription) {
          try {
            await this.pc.addIceCandidate(data.candidate as RTCIceCandidateInit);
          } catch {
            // ignore
          }
        } else {
          this.iceQueue.push(data.candidate as RTCIceCandidateInit);
        }
        break;
    }
  }

  private flushIceQueue() {
    for (const c of this.iceQueue) {
      this.pc.addIceCandidate(c).catch(() => {});
    }
    this.iceQueue = [];
  }

  sendCtrl(msg: CtrlMessage) {
    if (this.ctrl?.readyState === 'open') this.ctrl.send(JSON.stringify(msg));
  }

  sendTelemetry(msg: TelemetryMessage) {
    if (this.telemetry?.readyState === 'open') this.telemetry.send(JSON.stringify(msg));
  }

  restartIce() {
    this.pc.restartIce();
  }

  get connected() {
    return this.ctrl?.readyState === 'open';
  }

  async stats(): Promise<RTCStatsReport> {
    return this.pc.getStats();
  }

  close() {
    this.pc.close();
    this.cb.onClosed(this.peerId);
  }

  private attachCtrl(ch: RTCDataChannel) {
    this.ctrl = ch;
    ch.onmessage = (e) => this.cb.onCtrl(this.peerId, JSON.parse(e.data));
    ch.onopen = () => {
      if (!this.opened) {
        this.opened = true;
        this.cb.onOpen(this.peerId);
      }
    };
    ch.onclose = () => this.cb.onClosed(this.peerId);
  }

  private attachTelemetry(ch: RTCDataChannel) {
    this.telemetry = ch;
    ch.onmessage = (e) => this.cb.onTelemetry(this.peerId, JSON.parse(e.data));
  }
}
