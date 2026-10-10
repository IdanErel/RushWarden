/**
 * The bundled card set: every file in `packages/content/cards/`, imported statically so both Vite
 * and Node bundle it. Adding a card means adding its JSON file and one line here; a test fails if
 * the two disagree.
 */
import type { CardFile } from './card.js';

export const CARD_FILES: readonly CardFile[] = [];
