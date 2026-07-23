import { describe, it, expect } from 'vitest';
import {
  median,
  actionWins,
  driftDecision,
  naturalSort,
  generateRoomCode,
} from './syncmath';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './protocol';

describe('median', () => {
  it('нечётная длина', () => expect(median([3, 1, 2])).toBe(2));
  it('чётная длина — среднее двух центральных', () => expect(median([1, 2, 3, 4])).toBe(2.5));
  it('пустой массив', () => expect(median([])).toBe(0));
  it('устойчива к выбросам', () => expect(median([10, 11, 12, 13, 1000])).toBe(12));
});

describe('actionWins (last-action-wins)', () => {
  const last = { seq: 5, actorId: 'p_bbb' };
  it('больший seq побеждает', () => expect(actionWins({ seq: 6, actorId: 'p_aaa' }, last)).toBe(true));
  it('меньший seq проигрывает', () => expect(actionWins({ seq: 4, actorId: 'p_zzz' }, last)).toBe(false));
  it('равный seq — больший actorId побеждает', () =>
    expect(actionWins({ seq: 5, actorId: 'p_ccc' }, last)).toBe(true));
  it('равный seq — меньший actorId проигрывает', () =>
    expect(actionWins({ seq: 5, actorId: 'p_aaa' }, last)).toBe(false));
  it('полностью равные — не побеждает (идемпотентность)', () =>
    expect(actionWins(last, last)).toBe(false));
});

describe('driftDecision', () => {
  it('в мёртвой зоне — ничего', () =>
    expect(driftDecision(0.05, false)).toEqual({ kind: 'none' }));
  it('отстаём (drift<0) — ускоряемся', () =>
    expect(driftDecision(-0.5, false)).toEqual({ kind: 'speed', factor: 1.05 }));
  it('спешим (drift>0) — замедляемся', () =>
    expect(driftDecision(0.5, false)).toEqual({ kind: 'speed', factor: 0.95 }));
  it('большой дрейф — seek', () => expect(driftDecision(3, false)).toEqual({ kind: 'seek' }));
  it('вернулись в зону во время коррекции — сброс скорости на 1', () =>
    expect(driftDecision(0.05, true)).toEqual({ kind: 'speed', factor: 1 }));
  it('ровно порог seek — seek', () =>
    expect(driftDecision(2.5, false)).toEqual({ kind: 'seek' }));
});

describe('naturalSort', () => {
  it('серии по возрастанию номера, не лексикографически', () => {
    const input = [{ name: 'ep10.mkv' }, { name: 'ep2.mkv' }, { name: 'ep1.mkv' }];
    expect(naturalSort(input).map((i) => i.name)).toEqual(['ep1.mkv', 'ep2.mkv', 'ep10.mkv']);
  });
  it('не мутирует исходный массив', () => {
    const input = [{ name: 'b' }, { name: 'a' }];
    naturalSort(input);
    expect(input[0].name).toBe('b');
  });
});

describe('generateRoomCode', () => {
  it('нужная длина и алфавит', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
  });
  it('без похожих символов 0/O/1/I/L', () => {
    // 300 кодов — детерминированный псевдо-рандом
    let seed = 42;
    const rng = (n: number) =>
      Uint8Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) & 0xff));
    for (let i = 0; i < 300; i++) {
      expect(generateRoomCode(rng)).not.toMatch(/[0O1IL]/);
    }
  });
});
