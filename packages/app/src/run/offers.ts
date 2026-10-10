import { nextInt, type PrngState } from '@rushwarden/sim';
import { TAG_ORDER, type DeckCard, type Rarity, type RunCard, type CardTag } from './types.js';

/** GDD §4 offer weights: common 60%, uncommon 30%, rare 10%. */
export const RARITY_WEIGHTS: readonly [Rarity, number][] = [
  ['common', 60],
  ['uncommon', 30],
  ['rare', 10],
];
export const OFFER_SIZE = 3;
/** GDD §2: the pity rule applies from the offer made after passing round 3 (`round >= 3`). */
export const PITY_AFTER_ROUND = 3;

/** The tag most cards in the deck carry; ties go to the earlier tag in TAG_ORDER. */
export function dominantTag(
  deck: readonly DeckCard[],
  cards: ReadonlyMap<string, RunCard>,
): CardTag | null {
  const counts = new Map<CardTag, number>();
  for (const c of deck)
    for (const t of cards.get(c.id)?.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best: CardTag | null = null;
  let bestN = 0;
  for (const t of TAG_ORDER) {
    const n = counts.get(t) ?? 0;
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

function rollRarity(prng: PrngState): Rarity {
  let r = nextInt(prng, 100);
  for (const [rarity, w] of RARITY_WEIGHTS) {
    if (r < w) return rarity;
    r -= w;
  }
  return 'common';
}

/**
 * Builds a 3-card offer (GDD §4 draft rules): rarity by weight; no card twice in one offer; no
 * `run`-duration card the deck already holds; after round 3, at least one card of the deck's
 * dominant tag when the pool has one (pity rule, GDD §2). Mutates `prng`. Returns card ids.
 */
export function buildOffer(
  pool: readonly RunCard[],
  deck: readonly DeckCard[],
  round: number,
  prng: PrngState,
): string[] {
  const byId = new Map(pool.map((c) => [c.id, c]));
  const inDeck = new Set(deck.map((c) => c.id));
  const eligible = pool.filter((c) => !(c.duration === 'run' && inDeck.has(c.id)));
  const offer: RunCard[] = [];
  for (let i = 0; i < OFFER_SIZE; i++) {
    const left = eligible.filter((c) => !offer.includes(c));
    if (left.length === 0) break;
    const rarity = rollRarity(prng);
    const ofRarity = left.filter((c) => c.rarity === rarity);
    const from = ofRarity.length > 0 ? ofRarity : left;
    offer.push(from[nextInt(prng, from.length)] as RunCard);
  }
  // ADR-018 point 6: from the offer made after passing round 3.
  if (round >= PITY_AFTER_ROUND && offer.length > 0) {
    const tag = dominantTag(deck, byId);
    if (tag && !offer.some((c) => c.tags.includes(tag))) {
      const withTag = eligible.filter((c) => c.tags.includes(tag) && !offer.includes(c));
      if (withTag.length > 0)
        offer[offer.length - 1] = withTag[nextInt(prng, withTag.length)] as RunCard;
    }
  }
  return offer.map((c) => c.id);
}
