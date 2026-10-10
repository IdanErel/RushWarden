/**
 * Spawns the fake-traffic worker. Dev pages and tests only: it lives outside the package's main
 * entry (`@rushwarden/render/fake-worker`), so a production bundle that imports
 * `@rushwarden/render` never emits the fake worker.
 */
import type { WorkerLike } from './protocol.js';

export function spawnFakeWorker(): WorkerLike {
  return new Worker(new URL('./fake.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}
