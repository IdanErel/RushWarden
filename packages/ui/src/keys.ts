/**
 * Keyboard map (GDD §8): 1–5 select cards, arrows move a target cursor, Enter places,
 * Space = Go, Esc = undo/pause. Pure: maps (phase, key) to an action the screen applies.
 */
import type { Side } from '@rushwarden/sim';
import type { Phase } from './run/port.js';

export type KeyAction =
  | { readonly type: 'select'; readonly index: number }
  | { readonly type: 'cursor'; readonly dir: Side }
  | { readonly type: 'confirm' }
  | { readonly type: 'go' }
  | { readonly type: 'undo' }
  | { readonly type: 'pause' }
  | { readonly type: 'skip' }
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
  switch (phase) {
    case 'place':
      if (digit >= 0) return { type: 'select', index: digit };
      if (ARROWS[key]) return { type: 'cursor', dir: ARROWS[key] };
      if (key === 'Enter') return { type: 'confirm' };
      if (key === ' ' || key === 'Spacebar') return { type: 'go' };
      if (key === 'Escape' || key === 'Backspace') return { type: 'undo' };
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
