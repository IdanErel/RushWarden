import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatSoak, soak } from './soak.js';

/**
 * `pnpm --filter @rushwarden/soak run soak [--runs 500] [--out FILE] [--commit SHA]`
 * Exits 1 unless the soak is clean. Run with `node --expose-gc` (the script does) so heap
 * samples follow a full GC.
 */
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    runs: { type: 'string', default: '500' },
    out: { type: 'string' },
    commit: { type: 'string' },
    'limit-mb': { type: 'string', default: '2' },
    warmup: { type: 'string', default: '50' },
  },
});

function int(name: string, v: string | undefined, min: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min)
    throw new Error(`--${name} must be an integer ≥ ${min}, got ${v}`);
  return n;
}

const runs = int('runs', values.runs, 1);
const limitBytes = int('limit-mb', values['limit-mb'], 1) * 1048576;
const warmupRuns = int('warmup', values.warmup, 0);
const commit =
  values.commit ??
  (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  })();

const gc = (globalThis as { gc?: () => void }).gc;
const start = performance.now();
const result = soak({
  runs,
  ...(gc ? { gc } : {}),
  onRun: (n) => {
    if (n % 50 === 0 || n === runs) process.stderr.write(`\r${n}/${runs} runs`);
  },
});
process.stderr.write('\n');
const { markdown, pass } = formatSoak(result, {
  commit,
  seconds: (performance.now() - start) / 1000,
  limitBytes,
  warmupRuns: Math.min(warmupRuns, runs),
});
process.stdout.write(markdown);
if (values.out) {
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markdown);
}
process.exit(pass ? 0 : 1);
