/**
 * Main-thread side of the sim worker. The main thread only draws (GDD §3) and, per the shared
 * protocol, owns timing: `update(now)` is called once per display frame, accumulates sim time
 * (wall time × speed), keeps a few ticks requested ahead from the worker, and releases one
 * snapshot per 50 ms of sim time (25 ms at 2×) to `onFrame`. The scene then interpolates between
 * the last two released snapshots, so playback is smooth and never ahead of the sim.
 */
import type { RoundInput, RoundResult } from '@rushwarden/sim';
import { TICK_MS } from '../interpolate.js';
import { MAX_TICKS_PER_STEP, type WorkerLike } from './protocol.js';

export interface SimClientHandlers {
  /** One snapshot, released at its tick time. `now` is the `update` time that released it. */
  onFrame?: (snapshot: Uint16Array, now: number) => void;
  /** The round ended and every frame has been released. */
  onDone?: (result: RoundResult) => void;
  onError?: (message: string) => void;
}

/** Spawns the bundled sim worker. Vite (and other bundlers) resolve this URL pattern. */
export function spawnSimWorker(): WorkerLike {
  return new Worker(new URL('./sim.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

/** Spawns the fake-traffic worker (dev page only). */
export function spawnFakeWorker(): WorkerLike {
  return new Worker(new URL('./fake.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

/** Sim time requested ahead of playback, in ms; covers worker latency without adding lag. */
const LOOKAHEAD_MS = 150;

export class SimClient {
  private roundId = 0;
  private queue: Uint16Array[] = [];
  private inFlight = 0;
  private result: RoundResult | null = null;
  private running = false;
  private paused = false;
  private speed = 1;
  private acc = 0;
  private last: number | null = null;

  constructor(
    private readonly worker: WorkerLike,
    private readonly handlers: SimClientHandlers = {},
  ) {
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.roundId !== this.roundId) return;
      switch (m.type) {
        case 'frames':
          this.queue.push(...m.frames);
          this.inFlight = Math.max(0, this.inFlight - m.frames.length);
          break;
        case 'done':
          this.result = m.result;
          this.inFlight = 0;
          break;
        case 'error':
          this.running = false;
          this.handlers.onError?.(m.message);
          break;
      }
    };
  }

  /** Starts a round; any previous round is dropped. Playback begins on the next `update`. */
  start(input: RoundInput): void {
    this.roundId++;
    this.queue = [];
    this.inFlight = 0;
    this.result = null;
    this.running = true;
    this.paused = false;
    this.acc = 0;
    this.last = null;
    this.worker.postMessage({ type: 'start', roundId: this.roundId, input });
    this.request();
  }

  /** Sim speed multiplier: 1 = 20 ticks/s, 2 = 40 ticks/s (GDD §3). */
  setSpeed(speed: number): void {
    this.speed = Number.isFinite(speed) && speed > 0 ? Math.min(speed, 8) : 1;
  }

  get currentSpeed(): number {
    return this.speed;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.last = null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Drops the current round. */
  stop(): void {
    if (this.running) this.worker.postMessage({ type: 'abort', roundId: this.roundId });
    this.running = false;
    this.queue = [];
  }

  /** Call once per display frame with a monotonic time in ms. */
  update(now: number): void {
    if (!this.running) return;
    if (this.paused || this.last === null) {
      this.last = now;
      return;
    }
    this.acc += (now - this.last) * this.speed;
    this.last = now;
    while (this.acc >= TICK_MS && this.queue.length > 0) {
      const f = this.queue.shift();
      this.acc -= TICK_MS;
      if (f) this.handlers.onFrame?.(f, now);
    }
    // Starved (worker late): do not bank time, or playback would jump when frames arrive.
    if (this.queue.length === 0) this.acc = Math.min(this.acc, TICK_MS);
    if (this.result && this.queue.length === 0) {
      const r = this.result;
      this.running = false;
      this.result = null;
      this.handlers.onDone?.(r);
      return;
    }
    this.request();
  }

  private request(): void {
    if (this.result) return;
    const want = Math.ceil((LOOKAHEAD_MS * this.speed) / TICK_MS);
    const need = Math.min(MAX_TICKS_PER_STEP, want - this.queue.length - this.inFlight);
    if (need <= 0) return;
    this.inFlight += need;
    this.worker.postMessage({ type: 'step', roundId: this.roundId, ticks: need });
  }

  dispose(): void {
    this.stop();
    this.worker.onmessage = null;
    this.worker.terminate();
  }
}
