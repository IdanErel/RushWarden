import { describe, expect, it } from 'vitest';
import { nextSlots, sameSlots, slotViews } from '../src/slots.js';

describe('fixed hand slots (playtest U4)', () => {
  it('keeps a played card in its slot, so the other cards keep their numbers', () => {
    const start = [10, 11, 12, 13, 14];
    // Card 11 played: the hand closes up, the slots do not.
    const after = nextSlots(start, [10, 12, 13, 14], [11]);
    expect(after).toEqual(start);
    expect(slotViews(after, [10, 12, 13, 14], [11])).toEqual([
      { kind: 'hand', uid: 10, handIndex: 0 },
      { kind: 'played', uid: 11 },
      { kind: 'hand', uid: 12, handIndex: 1 },
      { kind: 'hand', uid: 13, handIndex: 2 },
      { kind: 'hand', uid: 14, handIndex: 3 },
    ]);
  });

  it('gives an undone card its slot back', () => {
    const slots = nextSlots([10, 11, 12], [10, 12], [11]);
    expect(nextSlots(slots, [10, 11, 12], [])).toEqual([10, 11, 12]);
  });

  it('refills a redraw into the same places and adds drawn cards on the end', () => {
    // Recount (13) played; 10, 11, 12 go back and 20, 21, 22 come in.
    expect(nextSlots([10, 11, 12, 13], [20, 21, 22], [13])).toEqual([20, 21, 22, 13]);
    // A draw adds a card.
    expect(nextSlots([10, 11], [10, 11, 30], [])).toEqual([10, 11, 30]);
  });

  it('compares slots', () => {
    expect(sameSlots([1, 2], [1, 2])).toBe(true);
    expect(sameSlots([1, 2], [2, 1])).toBe(false);
    expect(sameSlots([1], [1, 2])).toBe(false);
  });
});
