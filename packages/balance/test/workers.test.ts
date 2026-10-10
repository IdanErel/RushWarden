import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { BOT_NAMES } from '../src/balance.js';
import { runJob, splitJobs } from '../src/jobs.js';
import { runJobs, workerPool } from '../src/pool.js';
import { seedSet } from '../src/runner.js';

/** End to end on real worker threads: bundles the CLI and worker like `pnpm report` does. */
let dir = '';
beforeAll(async () => {
  // Inside the package, so the bundle resolves `prettier` (kept external) like dist/ does.
  dir = mkdtempSync(join(new URL('../node_modules/', import.meta.url).pathname, '.balance-test-'));
  await build({
    entryPoints: { cli: 'src/cli.ts', worker: 'src/worker.ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outdir: dir,
    outExtension: { '.js': '.mjs' },
    external: ['prettier'],
    logLevel: 'error',
  });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('worker threads', () => {
  it('a pool of worker threads gives the same records as in-process runs', async () => {
    const jobs = splitJobs(BOT_NAMES, seedSet(6), 'toy', 3, 2);
    const pool = workerPool(new URL(`file://${dir}/worker.mjs`), 3);
    try {
      const parallel = await runJobs(jobs, 3, pool.exec, BOT_NAMES);
      const serial = await runJobs(jobs, 1, async (j) => runJob(j), BOT_NAMES);
      expect(parallel).toEqual(serial);
    } finally {
      await pool.close();
    }
  });

  it('surfaces a worker error as a rejected job', async () => {
    const pool = workerPool(new URL(`file://${dir}/worker.mjs`), 1);
    try {
      await expect(
        pool.exec({ bot: 'nope', seeds: [1], preset: 'toy', targetsPerKind: 3 }),
      ).rejects.toThrow(/unknown bot/);
    } finally {
      await pool.close();
    }
  });

  it('the CLI writes byte-identical reports with 0 and 3 workers', () => {
    const run = (workers: number): string => {
      const out = join(dir, `r${workers}.md`);
      execFileSync(
        'node',
        [
          join(dir, 'cli.mjs'),
          '--seeds',
          '4',
          '--preset',
          'toy',
          '--workers',
          String(workers),
          '--chunk',
          '3',
          '--commit',
          'test',
          '--out',
          out,
        ],
        {
          stdio: 'pipe',
        },
      );
      return readFileSync(out, 'utf8');
    };
    const serial = run(0);
    expect(run(3)).toBe(serial);
    expect(serial).toContain('seeds 1–4 per bot · 28 runs · commit `test`');
  });
});
