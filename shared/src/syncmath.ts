// Чистые функции sync-логики — без mpv/DOM, тестируются напрямую.

import {
  DRIFT_DEADZONE_S,
  DRIFT_SEEK_THRESHOLD_S,
  CATCHUP_SPEED_FACTOR,
  SLOWDOWN_SPEED_FACTOR,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from './protocol';

/** Код комнаты из crypto-случайных байт по алфавиту без похожих символов. */
export function generateRoomCode(randomBytes: (n: number) => Uint8Array = cryptoBytes): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = '';
  for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return code;
}

function cryptoBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Медиана массива (для оценки clock offset/RTT). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Побеждает ли входящее действие (a) над последним применённым (b): выше seq, при равенстве — больший actorId. */
export function actionWins(
  a: { seq: number; actorId: string },
  b: { seq: number; actorId: string },
): boolean {
  return a.seq > b.seq || (a.seq === b.seq && a.actorId > b.actorId);
}

export type DriftCorrection =
  | { kind: 'none' }
  | { kind: 'speed'; factor: number }
  | { kind: 'seek' };

/** Решение дрейф-коррекции: drift = myPos - expectedPos. correcting — идёт ли сейчас подстройка скорости. */
export function driftDecision(drift: number, correcting: boolean): DriftCorrection {
  const abs = Math.abs(drift);
  if (abs >= DRIFT_SEEK_THRESHOLD_S) return { kind: 'seek' };
  if (abs > DRIFT_DEADZONE_S) {
    return { kind: 'speed', factor: drift < 0 ? CATCHUP_SPEED_FACTOR : SLOWDOWN_SPEED_FACTOR };
  }
  return correcting ? { kind: 'speed', factor: 1 } : { kind: 'none' };
}

/** Natural sort имён серий: "ep2" < "ep10". */
export function naturalSort<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
