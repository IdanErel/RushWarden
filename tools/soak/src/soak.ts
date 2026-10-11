/**
 * The release soak (GDD §11 "500 full runs per platform build without an exception; memory
 * flat"; Phase 1 test plan §2.3 and §5 item 3). Plays full 5-round toy runs headless with the
 * game's own wiring (`toyRunConfig`, content's cards, starting deck and `setupRound`), with the
 * Phase 1 bots taking turns so random, greedy and every archetype's plays are exercised.
 *
 * Each round is played twice, the two ways the game plays it: the run controller's `go`
 * (`Sim.simulate`, what scores the round) and the browser's sim worker, driven through its real
 * handler (`createSimWorkerHandler`, the code `render/src/worker/sim.worker.ts` runs) with `step`
 * requests of varying size as the main thread sends them. Their final hashes must match. An
 * exception, an `error` message from the worker, a round with no `done`, a run that does not end
 * within its rounds, or a hash mismatch fails the soak, with the seed and bot to reproduce it.
 *
 * It is headless: app, sim, content and the bots. The browser build's own memory (the Pixi
 * scene, textures, listeners) is not covered; that is the device checklist and the frame-time
 * trace (test plan §2.3 and §3).
 *
 * Portal builds (itch, Poki, CrazyGames) share this code path: they differ in the portal adapter
 * and analytics only, so one soak covers them all in Phase 1.
 */
import {
  roundInput,
  startRun,
  step,
  type RunAction,
  type RunEnv,
  type RunState,
} from '@rushwarden/app';
import {
  CARDS,
  CONTENT_ENV,
  botContext,
  configFor,
  phase1Bots,
  type Bot,
} from '@rushwarden/balance';
import {
  MAX_TICKS_PER_STEP,
  createSimWorkerHandler,
  createPrng,
  nextInt,
  type FromSimWorker,
  type PostFromWorker,
  type RoundInput,
  type ToSimWorker,
} from '@rushwarden/sim';

export interface SoakFailure {
  readonly seed: number;
  readonly bot: string;
  readonly round: number;
  readonly error: string;
}

export interface SoakOptions {
  /** Runs to play (seeds 1..runs). GDD §11: 500. */
  readonly runs: number;
  /** Bots in turn: run i plays with `bots[i % bots.length]`. Default: the Phase 1 bots. */
  readonly bots?: readonly Bot[];
  /** Targets per kind the lookahead bots try (the balance runner's default is 3). */
  readonly targetsPerKind?: number;
  /** Heap sample every this many runs (after a GC when `gc` is given). */
  readonly sampleEvery?: number;
  /** `globalThis.gc` under `node --expose-gc`; samples are noisier without it. */
  readonly gc?: () => void;
  readonly heapUsed?: () => number;
  readonly onRun?: (done: number) => void;
  /** The sim worker handler; tests inject a faulty one. */
  readonly makeHandler?: WorkerFactory;
}

export interface HeapSample {
  readonly run: number;
  readonly bytes: number;
}

export interface SoakResult {
  readonly runs: number;
  readonly rounds: number;
  readonly ticks: number;
  readonly wins: number;
  readonly gridlocks: number;
  readonly byBot: Readonly<Record<string, number>>;
  readonly failures: readonly SoakFailure[];
  readonly heap: readonly HeapSample[];
  readonly gcForced: boolean;
}

/** Same salt rule as the balance runner, so a bot plays the same moves for a seed there and here. */
export function salt(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return h;
}

/** Makes a worker handler; tests pass one that misbehaves. */
export type WorkerFactory = (post: PostFromWorker) => (msg: ToSimWorker) => void;

/**
 * Plays a round through the browser sim worker's handler: `start`, then `step` requests of 1 to
 * `MAX_TICKS_PER_STEP` ticks (seeded, so a failure reproduces) until `done`. Throws on an `error`
 * message, on frames that do not add up to the result's ticks, or when no `done` arrives.
 */
export function workerRound(
  input: RoundInput,
  roundId: number,
  makeHandler: WorkerFactory = createSimWorkerHandler,
): { finalHash: string; ticks: number } {
  const posts: FromSimWorker[] = [];
  const handle = makeHandler((m) => posts.push(m));
  const prng = createPrng(input.seed ^ 0x50a1c);
  handle({ type: 'start', roundId, input });
  let frames = 0;
  for (let guard = 0; guard < 100_000; guard++) {
    handle({ type: 'step', roundId, ticks: 1 + nextInt(prng, MAX_TICKS_PER_STEP) });
    for (const m of posts.splice(0)) {
      if (m.type === 'error') throw new Error(`worker error: ${m.message}`);
      if (m.type === 'frames') frames += m.frames.length;
      if (m.type === 'done') {
        if (m.roundId !== roundId) throw new Error(`worker done for round ${m.roundId}`);
        if (frames !== m.result.ticks)
          throw new Error(`worker sent ${frames} frames for ${m.result.ticks} ticks`);
        return { finalHash: m.result.finalHash, ticks: m.result.ticks };
      }
    }
  }
  throw new Error('worker never sent done');
}

function apply(state: RunState, action: RunAction, env: RunEnv): RunState {
  const r = step(state, action, env);
  if (!r.ok) throw new Error(`refused ${JSON.stringify(action)}: ${r.error}`);
  return r.state;
}

interface RunStats {
  rounds: number;
  ticks: number;
  win: boolean;
  gridlocks: number;
}

/** One full toy run. Throws on any exception, overrun or hash mismatch; `at.round` says where. */
export function soakRun(
  seed: number,
  bot: Bot,
  targetsPerKind: number,
  at: { round: number },
  makeHandler?: WorkerFactory,
): RunStats {
  const env = CONTENT_ENV;
  const config = configFor('toy')(seed);
  const ctx = botContext(seed, salt(bot.name), env, CARDS, targetsPerKind);
  let state = startRun(config, env).state;
  let ticks = 0;
  for (let guard = 0; state.phase !== 'end'; guard++) {
    if (guard >= config.rounds) throw new Error(`run did not end within ${config.rounds} rounds`);
    at.round = state.round;
    for (const a of bot.plays(state, ctx)) state = apply(state, a, env);
    const worker = workerRound(roundInput(state), state.round, makeHandler);
    state = apply(state, { type: 'go' }, env);
    const outcome = state.history.at(-1);
    if (!outcome) throw new Error('go recorded no round outcome');
    if (outcome.finalHash !== worker.finalHash)
      throw new Error(
        `worker path hash ${worker.finalHash} != controller ${outcome.finalHash} (desync)`,
      );
    ticks += worker.ticks;
    if (state.phase === 'result') {
      const pick = state.offer ? bot.pick(state, ctx) : 'skip';
      state = apply(state, { type: 'choose', pick }, env);
    }
  }
  return {
    rounds: state.history.length,
    ticks,
    win: state.outcome === 'win',
    gridlocks: state.history.filter((o) => o.gridlocked).length,
  };
}

export function soak(opts: SoakOptions): SoakResult {
  const bots = opts.bots ?? phase1Bots();
  if (bots.length === 0) throw new RangeError('soak needs at least one bot');
  if (!Number.isInteger(opts.runs) || opts.runs < 1)
    throw new RangeError(`runs must be ≥ 1, got ${opts.runs}`);
  const every = opts.sampleEvery ?? 50;
  const heapUsed = opts.heapUsed ?? (() => process.memoryUsage().heapUsed);
  const sample = (run: number): HeapSample => {
    opts.gc?.();
    return { run, bytes: heapUsed() };
  };

  const failures: SoakFailure[] = [];
  const heap: HeapSample[] = [sample(0)];
  const byBot: Record<string, number> = {};
  let rounds = 0;
  let ticks = 0;
  let wins = 0;
  let gridlocks = 0;
  for (let i = 0; i < opts.runs; i++) {
    const seed = i + 1;
    const bot = bots[i % bots.length] as Bot;
    const at = { round: 0 };
    try {
      const r = soakRun(seed, bot, opts.targetsPerKind ?? 3, at, opts.makeHandler);
      rounds += r.rounds;
      ticks += r.ticks;
      if (r.win) wins++;
      gridlocks += r.gridlocks;
      byBot[bot.name] = (byBot[bot.name] ?? 0) + 1;
    } catch (e) {
      failures.push({
        seed,
        bot: bot.name,
        round: at.round,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if ((i + 1) % every === 0 || i + 1 === opts.runs) heap.push(sample(i + 1));
    opts.onRun?.(i + 1);
  }
  return {
    runs: opts.runs,
    rounds,
    ticks,
    wins,
    gridlocks,
    byBot,
    failures,
    heap,
    gcForced: opts.gc !== undefined,
  };
}

/**
 * "Memory flat" (§11): after the first sample past warm-up, the heap never grows by more than
 * `limit` bytes. Warm-up (lazy content caches, JIT) ends at the first sample at or after
 * `warmupRuns`. Returns the growth seen.
 */
export function heapGrowth(
  heap: readonly HeapSample[],
  warmupRuns: number,
): { base: number; max: number; growth: number } | null {
  const after = heap.filter((h) => h.run >= warmupRuns);
  const first = after[0];
  if (!first) return null;
  const max = Math.max(...after.map((h) => h.bytes));
  return { base: first.bytes, max, growth: max - first.bytes };
}

/** Markdown summary for the job summary and the release notes. */
export function formatSoak(
  r: SoakResult,
  opts: { commit: string; seconds: number; limitBytes: number; warmupRuns: number },
): { markdown: string; pass: boolean } {
  const g = heapGrowth(r.heap, opts.warmupRuns);
  const memOk = g !== null && g.growth <= opts.limitBytes;
  const pass = r.failures.length === 0 && memOk;
  const mb = (b: number): string => `${(b / 1048576).toFixed(1)} MB`;
  const lines = [
    `# Soak: ${pass ? 'clean' : 'FAILED'}`,
    '',
    `${r.runs} full toy runs, headless (5 rounds, \`toyRunConfig\`; app, sim, content and bots, not the browser's render or UI) at commit \`${opts.commit}\` in ${opts.seconds.toFixed(0)} s. GDD §11; Phase 1 test plan §5 item 3.`,
    '',
    '| Check | Result |',
    '| --- | --- |',
    `| Runs without an exception, ending within their rounds | ${r.runs - r.failures.length} of ${r.runs} |`,
    `| Rounds played (controller and sim worker handler hashes equal) | ${r.rounds} |`,
    `| Heap growth after run ${opts.warmupRuns} (limit ${mb(opts.limitBytes)}) | ${g ? mb(g.growth) : 'no sample'}${r.gcForced ? '' : ' (no forced GC)'} |`,
    '',
    `Wins ${r.wins}, gridlocked rounds ${r.gridlocks}, simulated ticks ${r.ticks}. Runs per bot: ${Object.entries(
      r.byBot,
    )
      .map(([b, n]) => `${b} ${n}`)
      .join(', ')}.`,
    '',
    `Heap samples (run: used): ${r.heap.map((h) => `${h.run}: ${mb(h.bytes)}`).join(' · ')}`,
  ];
  if (r.failures.length > 0) {
    lines.push(
      '',
      '## Failures',
      '',
      '| Seed | Bot | Round | Error |',
      '| --- | --- | --- | --- |',
    );
    for (const f of r.failures.slice(0, 50))
      lines.push(`| ${f.seed} | ${f.bot} | ${f.round} | ${f.error.replaceAll('|', '\\|')} |`);
    if (r.failures.length > 50) lines.push('', `…and ${r.failures.length - 50} more.`);
  }
  return { markdown: lines.join('\n') + '\n', pass };
}
