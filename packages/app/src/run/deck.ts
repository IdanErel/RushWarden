import { nextInt, type PrngState } from '@rushwarden/sim';
import type { DeckCard } from './types.js';

/** Fisher–Yates shuffle with the run PRNG. Mutates `prng`; returns a new array. */
export function shuffle<T>(items: readonly T[], prng: PrngState): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(prng, i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/**
 * Draws `count` cards from the top of the draw pile. When the pile runs out, the spent pile is
 * shuffled in (GDD §4 "deck shuffles when empty"). Mutates `prng`.
 */
export function draw(
  drawPile: readonly DeckCard[],
  spent: readonly DeckCard[],
  count: number,
  prng: PrngState,
): { drawn: DeckCard[]; drawPile: DeckCard[]; spent: DeckCard[] } {
  let pile = drawPile.slice();
  let used = spent.slice();
  const drawn: DeckCard[] = [];
  while (drawn.length < count) {
    if (pile.length === 0) {
      if (used.length === 0) break;
      pile = shuffle(used, prng);
      used = [];
    }
    drawn.push(pile.shift() as DeckCard);
  }
  return { drawn, drawPile: pile, spent: used };
}
