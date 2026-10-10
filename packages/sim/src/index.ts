/**
 * @gridlock/sim — the deterministic, integer-only traffic simulation (GDD section 3).
 *
 * ```ts
 * import { Sim } from '@gridlock/sim';
 * const result = Sim.simulate(input); // headless, e.g. balance runner or /verify
 *
 * let state = Sim.init(input);        // tick-by-tick, e.g. the render worker
 * while (!state.done) { state = Sim.step(state); post(Sim.snapshot(state)); }
 * const sameResult = Sim.result(state);
 * ```
 */
import { init, result, simulate, snapshot, stateHash, step } from './sim.js';

export const Sim = { simulate, init, step, snapshot, result, stateHash } as const;

export * from './types.js';
export { Hasher, hashValue } from './hash.js';
export { createPrng, clonePrng, nextU32, nextInt, chancePermille, type PrngState } from './prng.js';
export { idiv, imod, pct, clamp } from './math.js';
export { emptyMap, sampleInput } from './fixtures.js';
