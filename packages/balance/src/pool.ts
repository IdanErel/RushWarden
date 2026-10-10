import { Worker } from 'node:worker_threads';
import type { RunJob } from './jobs.js';
import { canonical, type RunRecord } from './runner.js';

/** Runs one job somewhere (in-process for tests, a worker thread for real runs). */
export type Executor = (job: RunJob) => Promise<RunRecord[]>;

/**
 * Runs jobs with at most `concurrency` in flight and returns the records in canonical
 * (bot order, seed) order, so the result does not depend on scheduling or worker count.
 */
export async function runJobs(
  jobs: readonly RunJob[],
  concurrency: number,
  exec: Executor,
  botOrder: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  let next = 0;
  let done = 0;
  const lane = async (): Promise<void> => {
    for (let job = jobs[next++]; job; job = jobs[next++]) {
      out.push(...(await exec(job)));
      onProgress?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, lane));
  return canonical(out, botOrder);
}

type Reply = { readonly id: number; readonly records?: RunRecord[]; readonly error?: string };

/**
 * A fixed pool of `size` worker threads running `workerUrl` (the bundled `worker.ts`). Each
 * `exec` goes to an idle worker; call `close` when done.
 */
export function workerPool(
  workerUrl: URL,
  size: number,
): { exec: Executor; close: () => Promise<void> } {
  const idle: Worker[] = [];
  const waiting: ((w: Worker) => void)[] = [];
  const all: Worker[] = [];
  for (let i = 0; i < size; i++) {
    const w = new Worker(workerUrl);
    all.push(w);
    idle.push(w);
  }
  const acquire = (): Promise<Worker> =>
    new Promise((resolve) => {
      const w = idle.pop();
      if (w) resolve(w);
      else waiting.push(resolve);
    });
  const release = (w: Worker): void => {
    const take = waiting.shift();
    if (take) take(w);
    else idle.push(w);
  };
  let ids = 0;
  const exec: Executor = async (job) => {
    const w = await acquire();
    const id = ++ids;
    try {
      return await new Promise<RunRecord[]>((resolve, reject) => {
        const onMessage = (m: Reply): void => {
          if (m.id !== id) return;
          cleanup();
          if (m.error !== undefined) reject(new Error(m.error));
          else resolve(m.records ?? []);
        };
        const onError = (e: Error): void => {
          cleanup();
          reject(e);
        };
        const cleanup = (): void => {
          w.off('message', onMessage);
          w.off('error', onError);
        };
        w.on('message', onMessage);
        w.on('error', onError);
        w.postMessage({ id, job });
      });
    } finally {
      release(w);
    }
  };
  return { exec, close: async () => void (await Promise.all(all.map((w) => w.terminate()))) };
}
