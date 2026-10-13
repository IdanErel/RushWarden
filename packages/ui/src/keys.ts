/**
 * Keyboard map (GDD §8): 1–5 select cards, arrows move a target cursor, Enter places,
 * Space = Go (and pause/resume in Go), Esc = undo/pause, R = flip the last placed One-Way, M = sound on/off. Pure: maps
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
  /** Space in Go: pause or resume the board, without the menu (playtest U3). */
  | { readonly type: 'togglePause' }
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
  const digit = /^[1-5]$/.test(key) ? Number(key) - 1 : -1;
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
      if (key === ' ') return { type: 'togglePause' };
      return null;
    case 'result':
      if (digit >= 0 && digit < 3) return { type: 'select', index: digit };
      if (ARROWS[key] === 'w' || ARROWS[key] === 'e') return { type: 'cursor', dir: ARROWS[key] };
      if (key === 'Enter' || key === ' ') return { type: 'confirm' };
      if (key === 'Escape' || key === 's' || key === 'S') return { type: 'skip' };
      return null;
    case 'end':
      // Enter only: a stray Space (the Go and pause key) must never start a new run (U2).
      if (key === 'Enter') return { type: 'confirm' };
      return null;
  }
}
