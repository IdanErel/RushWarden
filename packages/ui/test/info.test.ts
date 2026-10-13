import { afterEach, describe, expect, it, vi } from 'vitest';
import { busyFactor, markLabel, readTipSeen, writeTipSeen } from '../src/info.js';
import type { RoundOutcome } from '../src/run/port.js';

const round = (quota: number): RoundOutcome => ({
  round: 1,
  pass: true,
  throughput: quota,
  quota,
  gridlocked: false,
  fundsEarned: 0,
  approvalLost: 0,
  hash: '',
});

describe('information layer helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('notes a busy map from 1.5× round 1’s quota', () => {
    expect(busyFactor(300, [])).toBeNull();
    expect(busyFactor(170, [round(120)])).toBeNull();
    expect(busyFactor(180, [round(120)])).toBe(1.5);
    expect(busyFactor(426, [round(120), round(130)])).toBe(3.6);
  });

  it('names each share mark', () => {
    expect(['pass', 'near', 'fail', 'gridlock'].map((m) => markLabel(m as never))).toEqual([
      'Passed',
      'Narrow pass',
      'Missed',
      'Gridlock',
    ]);
  });

  it('remembers the first-round tip, and survives storage that throws', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(readTipSeen()).toBe(false);
    writeTipSeen();
    expect(readTipSeen()).toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readTipSeen()).toBe(false);
    expect(() => writeTipSeen()).not.toThrow();
  });
});
