/**
 * The renderer's single seam onto the sim worker protocol. The message types and the sim-side
 * handler come from `@rushwarden/sim` (P1-LEAD-01, `packages/sim/src/protocol.ts`); this file
 * re-exports them and adds the minimal `WorkerLike` surface the client needs, so a protocol change
 * touches this file and `client.ts` only.
 *
 * GDD §6: "The main thread sends `RoundInput` and receives per-tick `Uint16Array` snapshots
 * (vehicle id, lane, cell, speed, type) via transferable buffers."
 */
import type { FromSimWorker, ToSimWorker } from '@rushwarden/sim';

export {
  MAX_TICKS_PER_STEP,
  createSimWorkerHandler,
  type FromSimWorker,
  type PostFromWorker,
  type ToSimWorker,
} from '@rushwarden/sim';

/** Minimal surface of a `Worker` used by the client, so tests can run it in memory. */
export interface WorkerLike {
  postMessage(message: ToSimWorker): void;
  onmessage: ((ev: { data: FromSimWorker }) => void) | null;
  terminate(): void;
}
