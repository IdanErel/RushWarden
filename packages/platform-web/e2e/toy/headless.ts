/**
 * The headless side of the toy e2e (docs/release/phase-1-test-plan.md §2.2): the same toy run
 * the game plays, replayed in Node with the run controller and the sim, for two jobs.
 *
 * 1. **Seed finder.** It picks seeds with a needed outcome (pass, fail, gridlock) when the specs
 *    run, instead of hard-coding them. Content tuning (P1-CON-05) changes which seed does what,
 *    so a hard-coded seed would silently stop testing its case. When no seed in range gives an
 *    outcome that a spec needs, that spec fails and names the outcome (`need()` in toy.spec.ts).
 * 2. **Reference hashes for E2E-06** ("rendered sim equals headless sim", GDD §1 zero desync).
 *
 * Contract with the game build (P1-WEB-01): the run seed is H1's `?seed=`, and the run is
 * `toyRunConfig({ seed, cards: loadCards(), startingDeck: startingDeck() })` with content's
 * `setupRound`. If the wiring differs, E2E-06 fails on the first round hash, which is the point.
 *
 * Every spec that uses this plays no cards: it presses Go and then skips the offer. Placing
 * cards is covered separately (E2E-02/03) and is not part of a hash comparison, because the
 * order of the UI's target list is the UI's own concern.
 */
import { startRun, step, toyRunConfig, type RunAction, type RunState } from '@rushwarden/app';
import { loadCards, setupRound, startingDeck } from '@rushwarden/content';

/** The §5 share mark of one round, as the run screen writes it in `data-history`. */
export type Mark = 'pass' | 'near' | 'fail' | 'gridlock';

export interface HeadlessRound {
  readonly round: number;
  readonly quota: number;
  readonly throughput: number;
  readonly pass: boolean;
  readonly gridlocked: boolean;
  readonly hash: string;
  readonly mark: Mark;
}

export interface HeadlessRun {
  readonly seed: number;
  readonly rounds: readonly HeadlessRound[];
  readonly outcome: 'win' | 'loss';
  readonly total: number;
}

const env = { setupRound };

/** Same rule as the run screen's `markOf` (§5: amber is a pass under 110% of quota). */
export function markOf(o: {
  pass: boolean;
  gridlocked: boolean;
  throughput: number;
  quota: number;
}): Mark {
  if (o.gridlocked) return 'gridlock';
  if (!o.pass) return 'fail';
  return o.throughput * 10 < o.quota * 11 ? 'near' : 'pass';
}

function apply(s: RunState, a: RunAction): RunState {
  const r = step(s, a, env);
  if (!r.ok) throw new Error(`headless toy run refused ${a.type}: ${r.error}`);
  return r.state;
}

/** The toy run for `seed` with no cards played: Go every round, skip every offer. */
export function noCardRun(seed: number): HeadlessRun {
  const config = toyRunConfig({ seed, cards: loadCards(), startingDeck: startingDeck() });
  let s = startRun(config, env).state;
  while (s.phase !== 'end') {
    s = apply(s, { type: 'go' });
    if (s.phase === 'result') s = apply(s, { type: 'choose', pick: 'skip' });
  }
  const rounds = s.history.map((o) => ({
    round: o.round,
    quota: o.quota,
    throughput: o.throughput,
    pass: o.pass,
    gridlocked: o.gridlocked,
    hash: o.finalHash,
    mark: markOf(o),
  }));
  return {
    seed,
    rounds,
    outcome: s.outcome ?? 'loss',
    total: rounds.reduce((n, r) => n + r.throughput, 0),
  };
}

export type SeedNeed =
  /** S1. Round 1 passes (E2E-01 to E2E-08, E2E-11 to E2E-13, E2E-16, E2E-18). */
  | 'pass-round-1'
  /** S2. Some round fails on quota without gridlock (E2E-06, E2E-09). */
  | 'fail'
  /** S3. Some round gridlocks (E2E-06, E2E-10). */
  | 'gridlock'
  /** The run ends on approval before its last round. E2E-09 uses it when the scan meets one. */
  | 'loss';

const NEEDS: Readonly<Record<SeedNeed, (r: HeadlessRun) => boolean>> = {
  'pass-round-1': (r) => r.rounds[0]?.mark === 'pass',
  fail: (r) => r.rounds.some((x) => x.mark === 'fail'),
  gridlock: (r) => r.rounds.some((x) => x.gridlocked),
  loss: (r) => r.outcome === 'loss',
};

/** The scan stops once S1–S3 are found; `loss` is kept only if it turns up on the way. */
const REQUIRED: readonly SeedNeed[] = ['pass-round-1', 'fail', 'gridlock'];

/**
 * Seeds searched, low first. A no-card toy run takes about 60 ms headless on a dev container, so
 * a full scan is about 35 s; with the content at the time of writing S1–S3 are 1, 416 and 246
 * and the scan stops at 416 (about 25 s). It runs once per Playwright worker.
 */
export const SEED_RANGE = { from: 1, to: 600 } as const;

let table: Partial<Record<SeedNeed, HeadlessRun>> | null = null;

/** One pass over `SEED_RANGE`: the lowest seed for each need, found on the same scan. */
export function seedTable(): Partial<Record<SeedNeed, HeadlessRun>> {
  if (table) return table;
  const found: Partial<Record<SeedNeed, HeadlessRun>> = {};
  for (let seed = SEED_RANGE.from; seed <= SEED_RANGE.to; seed++) {
    if (REQUIRED.every((n) => found[n])) break;
    const run = noCardRun(seed);
    for (const n of Object.keys(NEEDS) as SeedNeed[])
      if (!found[n] && NEEDS[n](run)) found[n] = run;
  }
  table = found;
  return found;
}

/** The lowest seed in `SEED_RANGE` whose no-card run has `need`, or null when the scan found none. */
export function findSeed(need: SeedNeed): HeadlessRun | null {
  return seedTable()[need] ?? null;
}
