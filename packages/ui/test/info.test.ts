import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  busyFactor,
  cutNote,
  heldLine,
  markLabel,
  readTipSeen,
  sideList,
  writeTipSeen,
} from '../src/info.js';
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
