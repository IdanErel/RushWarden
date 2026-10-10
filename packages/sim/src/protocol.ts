import { init, result, snapshot, step } from './sim.js';
import type { RoundInput, RoundResult, SimState } from './types.js';

/**
 * Message protocol between the main thread and the sim worker (GDD §6, "Determinism and the
 * worker"). Pull model: the main thread owns timing and asks for N ticks; the worker steps the
 * sim and answers with one snapshot per tick, sent as transferable buffers. The worker never
 * reads a clock, so the frames are identical to a headless run of the same input.
 */

/** Messages the main thread sends to the worker. */
export type ToSimWorker =
  /** Starts (or restarts) a round. Any previous round in this worker is discarded. */
  | { readonly type: 'start'; readonly roundId: number; readonly input: RoundInput }
  /** Advances up to `ticks` ticks; the worker replies with `frames` (and `done` at the end). */
  | { readonly type: 'step'; readonly roundId: number; readonly ticks: number }
  /** Runs the rest of the round at once (skip button, tests). Replies like `step`. */
  | { readonly type: 'finish'; readonly roundId: number }
  /** Drops the current round. No reply. */
  | { readonly type: 'abort'; readonly roundId: number };

/** Messages the worker sends to the main thread. */
export type FromSimWorker =
  /** Snapshots for consecutive ticks, oldest first (see `Sim.snapshot` for the layout). */
  | { readonly type: 'frames'; readonly roundId: number; readonly frames: readonly Uint16Array[] }
  /** Sent once, after the last frames of the round. `frames` is never included here. */
  | { readonly type: 'done'; readonly roundId: number; readonly result: RoundResult }
  | { readonly type: 'error'; readonly roundId: number; readonly message: string };

/** Upper bound on ticks per `step` request, so one message never blocks the worker for long. */
export const MAX_TICKS_PER_STEP = 60;

/** `postMessage` with an optional transfer list, as Worker, DedicatedWorkerGlobalScope and worker_threads provide. */
export type PostFromWorker = (msg: FromSimWorker, transfer: ArrayBuffer[]) => void;

/**
 * Creates the worker-side handler. Wire it as `self.onmessage = (e) => handle(e.data)` with
 * `post = (m, t) => self.postMessage(m, t)`. Messages for a stale `roundId` are ignored.
 */
export function createSimWorkerHandler(post: PostFromWorker): (msg: ToSimWorker) => void {
  let roundId = -1;
  let state: SimState | null = null;

  const advance = (ticks: number): void => {
    if (!state) return;
    const frames: Uint16Array[] = [];
    let n = 0;
    while (!state.done && n < ticks) {
      state = step(state);
      frames.push(snapshot(state));
      n++;
    }
    if (frames.length > 0) {
      post(
        { type: 'frames', roundId, frames },
        frames.map((f) => f.buffer as ArrayBuffer),
      );
    }
    if (state.done) {
      const { frames: _ignored, ...rest } = result(state);
      post({ type: 'done', roundId, result: rest }, []);
      state = null;
    }
  };

  return (msg) => {
    try {
      switch (msg.type) {
        case 'start':
          roundId = msg.roundId;
          // Frames travel by message; the result never carries them.
          state = init({ ...msg.input, recordFrames: false });
          return;
        case 'step':
          if (msg.roundId !== roundId) return;
          advance(Math.max(0, Math.min(msg.ticks, MAX_TICKS_PER_STEP)));
          return;
        case 'finish':
          if (msg.roundId !== roundId) return;
          while (state) advance(MAX_TICKS_PER_STEP);
          return;
        case 'abort':
          if (msg.roundId === roundId) state = null;
          return;
      }
    } catch (err) {
      state = null;
      post(
        {
          type: 'error',
          roundId: msg.roundId,
          message: err instanceof Error ? err.message : String(err),
        },
        [],
      );
    }
  };
}
