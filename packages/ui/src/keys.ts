/**
 * Keyboard map (GDD §8): 1–5 (up to 7 with a bigger hand) select cards, arrows move a target cursor, Enter places,
 * Space = Go, Esc = undo/pause, R = flip the last placed One-Way, M = sound on/off. Pure: maps
 * (phase, key) to an action the screen applies.
 */
import type { Side } from '@rushwarden/sim';
import type { Phase } from './run/port.js';

export type KeyAction =
  | { readonly type: 'select'; readonly index: number }
  | { readonly type: 'cursor'; readonly dir: Side }
  | { readonly type: 'confirm' }
  | { readonly type: 'go' }
  | { readonly type: 'undo' }
  /** Turns the last placed One-Way round (GDD §4 "one-way in the chosen direction"). */
  | { readonly type: 'flip' }
  | { readonly type: 'pause' }
  | { readonly type: 'skip' }
  /** Sound on/off (a key press is a gesture, so it may start audio). */
  | { readonly type: 'mute' }
  | null;

const ARROWS: Readonly<Record<string, Side>> = {
  ArrowUp: 'n',
  ArrowRight: 'e',
  ArrowDown: 's',
  ArrowLeft: 'w',
};

export function keyAction(phase: Phase, key: string, overlayOpen = false): KeyAction {
  if (overlayOpen) return key === 'Escape' ? { type: 'pause' } : null;
  // 1–7: a hand is 5 cards, up to 7 after a draw bonus (Second Shift; playtest U10).
  const digit = /^[1-7]$/.test(key) ? Number(key) - 1 : -1;
  if (key === 'm' || key === 'M') return { type: 'mute' };
  switch (phase) {
    case 'place':
      if (digit >= 0) return { type: 'select', index: digit };
      if (ARROWS[key]) return { type: 'cursor', dir: ARROWS[key] };
      if (key === 'Enter') return { type: 'confirm' };
      if (key === ' ' || key === 'Spacebar') return { type: 'go' };
      if (key === 'Escape' || key === 'Backspace') return { type: 'undo' };
      if (key === 'r' || key === 'R') return { type: 'flip' };
      return null;
    case 'go':
      if (key === 'Escape' || key === 'p' || key === 'P') return { type: 'pause' };
      return null;
    case 'result':
      if (digit >= 0 && digit < 3) return { type: 'select', index: digit };
      if (ARROWS[key] === 'w' || ARROWS[key] === 'e') return { type: 'cursor', dir: ARROWS[key] };
      if (key === 'Enter' || key === ' ') return { type: 'confirm' };
      if (key === 'Escape' || key === 's' || key === 'S') return { type: 'skip' };
      return null;
    case 'end':
      if (key === 'Enter' || key === ' ') return { type: 'confirm' };
      return null;
  }
}
