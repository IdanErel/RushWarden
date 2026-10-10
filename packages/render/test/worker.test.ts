import { describe, expect, it } from 'vitest';
import { ROUND_TICKS, Sim, emptyMap, sampleInput, type FromSimWorker } from '@rushwarden/sim';
import { SimClient } from '../src/worker/client.js';
import { createFakeWorkerHandler } from '../src/worker/fake-handler.js';
import {
  createSimWorkerHandler,
  type ToSimWorker,
  type WorkerLike,
} from '../src/worker/protocol.js';
import { TICK_MS } from '../src/interpolate.js';

type Handler = (post: (m: FromSimWorker, t: ArrayBuffer[]) => void) => (m: ToSimWorker) => void;

/**
 * An in-memory worker: messages are structured-cloned both ways like a real Worker, and replies
 * are delivered when `flush()` is called (a real worker answers asynchronously).
 */
function memoryWorker(make: Handler): WorkerLike & {
  sent: ToSimWorker[];
  flush(): void;
  terminated: boolean;
} {
  const inbox: FromSimWorker[] = [];
  const handle = make((m, t) => inbox.push(structuredClone(m, { transfer: t })));
  const w = {
    onmessage: null as WorkerLike['onmessage'],
    sent: [] as ToSimWorker[],
    terminated: false,
    postMessage(m: ToSimWorker) {
      w.sent.push(m);
      handle(structuredClone(m));
    },
    flush() {
      for (const m of inbox.splice(0)) w.onmessage?.({ data: m });
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

/** Drives a client at 60 fps for `ms`, flushing worker replies each frame. */
function play(client: SimClient, w: { flush(): void }, from: number, ms: number): number {
  let t = from;
  for (; t <= from + ms; t += 1000 / 60) {
    w.flush();
    client.update(t);
  }
  return t;
}

describe('SimClient over the shared protocol', () => {
  it('releases one frame per tick of sim time, in order', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const ticks: number[] = [];
    const client = new SimClient(w, { onFrame: (f) => ticks.push(f[0]!) });
    client.start(sampleInput(1));
    play(client, w, 0, 1000);
    // About 20 ticks in one second at 1×, consecutive from 1.
    expect(ticks.length).toBeGreaterThanOrEqual(18);
    expect(ticks.length).toBeLessThanOrEqual(20);
    expect(ticks).toEqual(ticks.map((_, i) => i + 1));
    // It only asks for a short lookahead, never the whole round.
    const asked = w.sent.flatMap((m) => (m.type === 'step' ? [m.ticks] : []));
    expect(asked.reduce((a, b) => a + b, 0)).toBeLessThan(ticks.length + 10);
  });

  it('plays twice as fast at 2× and stops while paused', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const ticks: number[] = [];
    const client = new SimClient(w, { onFrame: (f) => ticks.push(f[0]!) });
    client.setSpeed(2);
    expect(client.currentSpeed).toBe(2);
    client.start(sampleInput(1));
    let t = play(client, w, 0, 500);
    expect(ticks.length).toBeGreaterThanOrEqual(18);
    client.pause();
    expect(client.isPaused).toBe(true);
    const n = ticks.length;
    t = play(client, w, t, 1000);
    expect(ticks.length).toBe(n);
    client.resume();
    client.setSpeed(1);
    play(client, w, t, 500);
    expect(ticks.length - n).toBeGreaterThanOrEqual(8);
    expect(ticks.length - n).toBeLessThanOrEqual(11);
    client.setSpeed(Number.NaN);
    expect(client.currentSpeed).toBe(1);
  });

  it('does not bank time while the worker is late', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const ticks: number[] = [];
    const client = new SimClient(w, { onFrame: (f) => ticks.push(f[0]!) });
    client.start(sampleInput(1));
    client.update(0);
    for (let t = 0; t < 1000; t += 16) client.update(t); // no flush: worker silent for 1 s
    w.flush();
    client.update(1016);
    expect(ticks.length).toBeLessThanOrEqual(1);
  });

  it('delivers every frame then the same result as a headless run', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const input = sampleInput(42);
    const ticks: number[] = [];
    let result: unknown = null;
    const client = new SimClient(w, {
      onFrame: (f) => ticks.push(f[0]!),
      onDone: (r) => (result = r),
    });
    client.setSpeed(8);
    client.start(input);
    play(client, w, 0, (ROUND_TICKS * TICK_MS) / 8 + 1000);
    expect(ticks).toHaveLength(ROUND_TICKS);
    const { frames: _f, ...expected } = Sim.simulate(input);
    expect(result).toEqual(expected);
  });

  it('ignores replies from an older round and reports errors', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const ticks: number[] = [];
    let error = '';
    const client = new SimClient(w, {
      onFrame: (f) => ticks.push(f[0]!),
      onError: (e) => (error = e),
    });
    client.start(sampleInput(1));
    client.start(sampleInput(2)); // the first round's frames are now stale
    play(client, w, 0, 200);
    expect(ticks[0]).toBe(1);
    expect(new Set(w.sent.filter((m) => m.type === 'step').map((m) => m.roundId))).toEqual(
      new Set([1, 2]),
    );
    client.start({ ...sampleInput(1), seed: -1 });
    w.flush();
    expect(error).toContain('seed');
    client.update(0); // not running after an error: no-op
    client.stop();
    client.dispose();
    expect(w.terminated).toBe(true);
    expect(w.onmessage).toBeNull();
  });

  it('aborts the round on stop', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const client = new SimClient(w);
    client.start(sampleInput(1));
    client.stop();
    expect(w.sent.at(-1)).toEqual({ type: 'abort', roundId: 1 });
  });
});

describe('fake worker handler', () => {
  const input = { ...sampleInput(3), map: emptyMap() };

  it('speaks the shared protocol and shows vehicles', () => {
    const w = memoryWorker(createFakeWorkerHandler);
    const counts: number[] = [];
    const client = new SimClient(w, { onFrame: (f) => counts.push(f[1]!) });
    client.start(input);
    play(client, w, 0, 2000);
    expect(Math.max(...counts)).toBeGreaterThan(0);
  });

  it('caps steps, finishes, aborts and ignores stale round ids', () => {
    const out: FromSimWorker[] = [];
    const h = createFakeWorkerHandler((m) => out.push(m));
    h({ type: 'step', roundId: 1, ticks: 5 }); // before start: ignored
    expect(out).toEqual([]);
    h({ type: 'start', roundId: 1, input });
    h({ type: 'step', roundId: 1, ticks: 1000 });
    expect(out[0]!.type === 'frames' && out[0]!.frames.length).toBe(60);
    h({ type: 'step', roundId: 2, ticks: 5 }); // stale
    h({ type: 'finish', roundId: 2 });
    expect(out).toHaveLength(1);
    h({ type: 'finish', roundId: 1 });
    expect(out.at(-1)).toMatchObject({ type: 'done', result: { ticks: ROUND_TICKS } });
    h({ type: 'start', roundId: 3, input });
    h({ type: 'abort', roundId: 3 });
    h({ type: 'step', roundId: 3, ticks: 5 });
    h({ type: 'abort', roundId: 4 });
    expect(out.at(-1)!.type).toBe('done');
  });
});

describe('controllers frames through the client (ADR-020)', () => {
  it('hands each frame its own tick’s controller frame from the sim worker', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const got: [number, number][] = [];
    const client = new SimClient(w, {
      onFrame: (f, _now, c) => got.push([f[0]!, c?.length ?? -1]),
    });
    client.start(sampleInput(6));
    play(client, w, 0, 500);
    expect(got.length).toBeGreaterThan(5);
    // One intersection on the plus map: 3 bytes per frame.
    for (const [, len] of got) expect(len).toBe(3);
  });

  it('passes controllers from the fake worker, aligned with its frames', () => {
    const w = memoryWorker(createFakeWorkerHandler);
    const lens: number[] = [];
    const client = new SimClient(w, { onFrame: (_f, _now, c) => lens.push(c?.length ?? -1) });
    client.start({ ...sampleInput(3), map: emptyMap() });
    play(client, w, 0, 300);
    expect(lens.length).toBeGreaterThan(0);
    expect(new Set(lens)).toEqual(new Set([3]));
  });
});
