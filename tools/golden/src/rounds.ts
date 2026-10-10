import { Sim, sampleInput } from '@gridlock/sim';

/** Number of seeded rounds in the golden suite (GDD section 3). */
export const GOLDEN_ROUNDS = 200;

/** Seeds are spread across the uint32 range so high bits are exercised too. */
export function goldenSeed(i: number): number {
  return Math.imul(i + 1, 0x9e3779b1) >>> 0;
}

/** Runs the suite and returns one final hash per round, in order. */
export function runGolden(): string[] {
  const out: string[] = [];
  for (let i = 0; i < GOLDEN_ROUNDS; i++)
    out.push(Sim.simulate(sampleInput(goldenSeed(i))).finalHash);
  return out;
}
