import { CLOCK_SAMPLES } from '../../../../shared/src/protocol';
import { median } from '../../../../shared/src/syncmath';

/**
 * Оценка смещения часов пира NTP-способом: peerTime ≈ localTime + offset.
 * Все времена — performance.now() соответствующей стороны (монотонные, мс).
 */
export class PeerClock {
  private samples: { offset: number; rtt: number }[] = [];

  addSample(tSent: number, tPeerRecv: number, tNow: number) {
    const rtt = tNow - tSent;
    if (rtt < 0) return;
    this.samples.push({ offset: tPeerRecv - (tSent + rtt / 2), rtt });
    if (this.samples.length > CLOCK_SAMPLES) this.samples.shift();
  }

  /** Медианное смещение: локальное время + offset = время пира. */
  get offset(): number {
    return median(this.samples.map((s) => s.offset));
  }

  get rtt(): number {
    return median(this.samples.map((s) => s.rtt));
  }

  get ready(): boolean {
    return this.samples.length >= 3;
  }
}
