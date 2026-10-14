import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/i18n.js';
import {
  busyFactor,
  cutNote,
  heldLine,
  markLabel,
  readTipSeen,
  sideList,
  writeTipSeen,
} from '../src/info.js';

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

  it('words what a placement cuts off, and what the result held back (ADR-035)', () => {
    expect(sideList(['n'])).toBe('north');
    expect(sideList(['n', 'w'])).toBe('north and west');
    expect(sideList(['n', 'e', 'w'])).toBe('north, east and west');
    expect(cutNote(null)).toBeNull();
    const cut = { exits: ['n'], exitCount: 1, entries: [], edges: [0], trucksOnly: false } as const;
    expect(cutNote(cut)).toBe('Cuts off the north exit: those trips go to another exit.');
    expect(cutNote({ ...cut, exits: ['n', 's'], exitCount: 3, trucksOnly: true })).toBe(
      'Cuts off the north and south exits for trucks: they go to another exit.',
    );
    expect(cutNote({ ...cut, entries: ['w'] })).toBe(
      'Cuts off the north exit: those trips go to another exit. Traffic from the west would have no way out and wait at the edge.',
    );
    expect(heldLine({})).toBeNull();
    expect(heldLine({ waiting: 0, diverted: 0 })).toBeNull();
    expect(heldLine({ waiting: 1 })).toBe('1 vehicle still waiting to enter at the edges.');
    expect(heldLine({ waiting: 12, diverted: 3 })).toBe(
      '12 vehicles still waiting to enter at the edges; 3 rerouted to another exit (their way was cut).',
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
