/** The bundled deck lists in `packages/content/decks/`, imported statically like the cards. */
import type { DeckFile } from './deck.js';
import phase1Starting from '../decks/phase1-starting.json' with { type: 'json' };

export const DECK_FILES: readonly DeckFile[] = [
  { source: 'phase1-starting.json', data: phase1Starting },
];

/** The deck the Phase 1 toy and the balance runner start every run with (ADR-007). */
export const PHASE1_STARTING_DECK_ID = 'phase1-starting';
