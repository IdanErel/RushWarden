import type { RunCard, RunEnv } from '@rushwarden/app';
import { loadCards, setupRound, startingDeck } from '@rushwarden/content';

/**
 * The game data the balance runner plays with: content's validated Phase 1 cards and starting
 * deck, and its District 1 round setup (map, demand, Market Day). `setupRound` is shaped to match
 * `RunEnv.setupRound` (#28).
 */
export const CARDS: readonly RunCard[] = loadCards();
export const STARTING_DECK: readonly string[] = startingDeck();
export const CONTENT_ENV: RunEnv = { setupRound };
