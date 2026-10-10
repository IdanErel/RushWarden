import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BOT_NAMES, buildReport, formatReport } from './balance.js';
import { PRESETS, runJob, splitJobs, type Preset } from './jobs.js';
import { runJobs, workerPool } from './pool.js';
import { seedSet } from './runner.js';

/**
 * `pnpm --filter @rushwarden/balance run report [-- --seeds N --workers W --preset full|toy --out F]`
 * Runs every Phase 1 bot on seeds 1..N and writes the Markdown report (default
 * `docs/balance/latest.md`). Defaults match ADR-010 point 2: 10,000 full District 1 runs per bot.
 */
// `pnpm run report -- --seeds 10` passes the `--` through to the script; drop it.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    seeds: { type: 'string', default: '10000' },
    workers: { type: 'string', default: String(availableParallelism()) },
    preset: { type: 'string', default: 'full' },
    out: {
      type: 'string',
      default: new URL('../../../docs/balance/latest.md', import.meta.url).pathname,
    },
    commit: { type: 'string' },
    targets: { type: 'string', default: '3' },
    chunk: { type: 'string', default: '100' },
  },
});

function int(name: string, v: string | undefined, min: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min)
    throw new Error(`--${name} must be an integer ≥ ${min}, got ${v}`);
  return n;
}

const seeds = int('seeds', values.seeds, 1);
const workers = int('workers', values.workers, 0);
const preset = values.preset as Preset;
if (!PRESETS.includes(preset)) throw new Error(`--preset must be one of ${PRESETS.join(', ')}`);
const commit =
  values.commit ??
  (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  })();

const jobs = splitJobs(
  BOT_NAMES,
  seedSet(seeds),
  preset,
  int('targets', values.targets, 1),
  int('chunk', values.chunk, 1),
);
const t0 = Date.now();
let records;
if (workers === 0) {
  records = await runJobs(jobs, 1, async (j) => runJob(j), BOT_NAMES);
} else {
  const pool = workerPool(new URL('./worker.mjs', import.meta.url), workers);
  try {
    records = await runJobs(jobs, workers, pool.exec, BOT_NAMES, (d, n) => {
      if (d % 10 === 0 || d === n) process.stderr.write(`\r${d}/${n} jobs`);
    });
  } finally {
    await pool.close();
  }
  process.stderr.write('\n');
}
const out = resolve(values.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await formatReport(buildReport(records, { preset, seeds, commit })));
console.log(
  `${records.length} runs on ${workers || 'no'} workers in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${out}`,
);
