import { parentPort } from 'node:worker_threads';
import { runJob, type RunJob } from './jobs.js';

/** Worker-thread entry: plays the jobs it is sent and posts back plain-data records. */
const port = parentPort;
if (!port) throw new Error('worker.ts must run in a worker thread');
port.on('message', ({ id, job }: { id: number; job: RunJob }) => {
  try {
    port.postMessage({ id, records: runJob(job) });
  } catch (e) {
    port.postMessage({ id, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  }
});
