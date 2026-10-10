/**
 * Main-thread side of the sim worker. The main thread only draws (GDD §3) and, per the shared
 * protocol, owns timing: `update(now)` is called once per display frame, accumulates sim time
 * (wall time × speed), keeps a few ticks requested ahead from the worker, and releases one
 * snapshot per 50 ms of sim time (25 ms at 2×) to `onFrame`. The scene then interpolates between
 * the last two released snapshots, so playback is smooth and never ahead of the sim.
 *
 * Playback is paced by the wall clock, not by display frames: a slow frame releases every tick
 * it covered (the scene draws only the newest, so frames are dropped, not the round slowed), the
 * lookahead grows with the frame time, and time spent waiting on a late worker is caught up when
 * its frames arrive. A 15 s round takes 15 s at 2 fps as at 60 fps.
 */
import type { RoundInput, RoundResult } from '@rushwarden/sim';
import { TICK_MS } from '../interpolate.js';
import { MAX_TICKS_PER_STEP, type WorkerLike } from './protocol.js';

export interface SimClientHandlers {
  /**
   * One snapshot, released at its tick time. `now` is the `update` time that released it.
   * `controllers` is the same tick's controller frame (ADR-020) when the worker sent one.
   */
  onFrame?: (snapshot: Uint16Array, now: number, controllers?: Uint8Array) => void;
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

/** Sim time requested ahead of playback, in ms; covers worker latency without adding lag. */
const LOOKAHEAD_MS = 150;
/**
 * Longest wall-clock gap one `update` counts, in ms. A longer gap (a background tab, a debugger)
 * resumes where it was instead of skipping the rest of the round.
 */
const MAX_GAP_MS = 2500;

export class SimClient {
  private roundId = 0;
  private queue: Uint16Array[] = [];
  /** Controller frames, aligned with `queue`; undefined where the producer sent none. */
  private ctrlQueue: (Uint8Array | undefined)[] = [];
  private inFlight = 0;
  private result: RoundResult | null = null;
  private running = false;
  private paused = false;
  private speed = 1;
  private acc = 0;
  private last: number | null = null;
  /** Recent display frame time in ms (smoothed); sizes the lookahead. */
  private frameMs = 1000 / 60;

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
          for (let k = 0; k < m.frames.length; k++) this.ctrlQueue.push(m.controllers?.[k]);
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

  /**
   * Starts a round; any previous round is dropped. Pass `now` (the Go press) to count the round's
   * time from then: on a slow device the first frame after Go can be a second away, and that time
   * is caught up instead of added to the round. Without it, playback begins on the next `update`.
   */
  start(input: RoundInput, now?: number): void {
    this.roundId++;
    this.queue = [];
    this.ctrlQueue = [];
    this.inFlight = 0;
    this.result = null;
    this.running = true;
    this.paused = false;
    this.acc = 0;
    this.last = now ?? null;
    this.frameMs = 1000 / 60;
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
    this.ctrlQueue = [];
  }

  /** Call once per display frame with a monotonic time in ms. */
  update(now: number): void {
    if (!this.running) return;
    if (this.paused || this.last === null) {
      this.last = now;
      return;
    }
    const gap = Math.min(Math.max(now - this.last, 0), MAX_GAP_MS);
    this.frameMs += (gap - this.frameMs) * 0.25;
    this.acc += gap * this.speed;
    this.last = now;
    while (this.acc >= TICK_MS && this.queue.length > 0) {
      const f = this.queue.shift();
      const c = this.ctrlQueue.shift();
      this.acc -= TICK_MS;
      if (f) this.handlers.onFrame?.(f, now, c);
    }
    // Starved (worker late): keep the time owed, up to one gap's worth, and catch up when the
    // frames arrive, so a late worker drops frames rather than stretching the round.
    if (this.queue.length === 0) this.acc = Math.min(this.acc, MAX_GAP_MS * this.speed);
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
    // Enough for the next two frames at the current frame time, plus the worker's latency.
    const ahead = LOOKAHEAD_MS + 2 * this.frameMs + this.acc / this.speed;
    const want = Math.ceil((ahead * this.speed) / TICK_MS);
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
