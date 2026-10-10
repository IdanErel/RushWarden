import { Sim, cardInput, denseInput, sampleInput, type RoundInput } from '@rushwarden/sim';

/** Number of seeded rounds in the golden suite (GDD section 3). */
export const GOLDEN_ROUNDS = 200;

/** Seeds are spread across the uint32 range so high bits are exercised too. */
export function goldenSeed(i: number): number {
  return Math.imul(i + 1, 0x9e3779b1) >>> 0;
}

/**
 * Round `i`'s input. Even rounds are the small plus-map `sampleInput` (0–6 vehicles). Rounds 1, 5,
 * 9, ... are `denseInput` (a lattice of 4–12 intersections with 50–150 vehicles of every type), so
 * every engine sees queues, contended boxes, taxi re-routes and multi-lane spawns. Rounds 3, 7,
 * 11, ... are `cardInput`: a dense round with 1–4 Phase 1 cards placed (controllers, topology,
 * demand and segment effects).
 */
export function goldenInput(i: number): RoundInput {
  const seed = goldenSeed(i);
  if (i % 2 === 0) return sampleInput(seed);
  return i % 4 === 1 ? denseInput(seed) : cardInput(seed);
}

/** Runs the suite and returns one final hash per round, in order. */
export function runGolden(): string[] {
  const out: string[] = [];
  for (let i = 0; i < GOLDEN_ROUNDS; i++) out.push(Sim.simulate(goldenInput(i)).finalHash);
  return out;
}
