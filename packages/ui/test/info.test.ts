import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/i18n.js';
import { busyFactor, markLabel, readTipSeen, writeTipSeen } from '../src/info.js';
describe('information layer helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('notes a busy map from 1.3× its round’s usual quota (QA R3)', () => {
    // Seed 11 opens with Market Day at quota 357, against a usual 194 for round 1.
    expect(busyFactor(357, 194)).toBe(1.8);
    expect(busyFactor(194, 194)).toBeNull();
    expect(busyFactor(197, 151)).toBe(1.3);
    expect(busyFactor(196, 151)).toBeNull();
    expect(busyFactor(500, null)).toBeNull();
    expect(busyFactor(500, 0)).toBeNull();
  });

  it('pluralises the result’s traffic line (QA N2)', () => {
    expect(t('result.traffic', { arrived: 124, left: 1 })).toBe(
      '124 vehicles arrived; 1 was still on the road when time ran out (they don’t count).',
    );
    expect(t('result.traffic', { arrived: 1, left: 0 })).toBe(
      '1 vehicle arrived; 0 were still on the road when time ran out (they don’t count).',
    );
    expect(t('result.trafficJam', { arrived: 39, left: 51 })).toBe(
      '39 vehicles arrived; 51 were still on the road when it locked.',
    );
    expect(t('result.trafficJam', { arrived: 2, left: 1 })).toBe(
      '2 vehicles arrived; 1 was still on the road when it locked.',
    );
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
