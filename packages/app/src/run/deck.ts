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
 * shuffled in (GDD §4 "deck shuffles when empty"). Cards `skip` returns true for are passed over
 * and stay on top of the pile in their order (the last round skips next-round cards, playtest
 * E2). Mutates `prng`.
 */
export function draw(
  drawPile: readonly DeckCard[],
  spent: readonly DeckCard[],
  count: number,
  prng: PrngState,
  skip?: (card: DeckCard) => boolean,
): { drawn: DeckCard[]; drawPile: DeckCard[]; spent: DeckCard[] } {
  let pile = drawPile.slice();
  let used = spent.slice();
  const drawn: DeckCard[] = [];
  const held: DeckCard[] = [];
  while (drawn.length < count) {
    if (pile.length === 0) {
      if (used.length === 0) break;
      pile = shuffle(used, prng);
      used = [];
    }
    const card = pile.shift() as DeckCard;
    if (skip?.(card)) held.push(card);
    else drawn.push(card);
  }
  return { drawn, drawPile: [...held, ...pile], spent: used };
}
