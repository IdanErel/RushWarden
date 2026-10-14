import { describe, expect, it } from 'vitest';
import { ROUND_TICKS, Sim, emptyMap, sampleInput, type FromSimWorker } from '@rushwarden/sim';
import { SimClient } from '../src/worker/client.js';
import { createFakeWorkerHandler, fakeWaitingFrame } from '../src/worker/fake-handler.js';
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

  it('catches up the time a late worker cost, so the round is not stretched', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const ticks: number[] = [];
    const client = new SimClient(w, { onFrame: (f) => ticks.push(f[0]!) });
    client.start(sampleInput(1));
    client.update(0);
    for (let t = 0; t < 1000; t += 16) client.update(t); // no flush: worker silent for 1 s
    // Once the worker answers, playback catches up to the wall clock within a few frames.
    play(client, w, 1000, 500);
    expect(ticks.length).toBeGreaterThanOrEqual(27);
    expect(ticks.length).toBeLessThanOrEqual(31);
    expect(ticks).toEqual(ticks.map((_, i) => i + 1));
  });

  it('counts the round from the Go press when start is given the time', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const ticks: number[] = [];
    const client = new SimClient(w, { onFrame: (f) => ticks.push(f[0]!) });
    client.start(sampleInput(1), 0);
    // The first display frame comes 1 s after Go (a slow device); then 60 fps.
    play(client, w, 1000, 500);
    expect(ticks.length).toBeGreaterThanOrEqual(28);
    expect(ticks.length).toBeLessThanOrEqual(31);
  });

  it('plays a round in wall-clock time at any frame rate, 2× and pause included', () => {
    for (const fps of [60, 10, 2]) {
      const w = memoryWorker(createSimWorkerHandler);
      let done = -1;
      let t = 0;
      const client = new SimClient(w, { onDone: () => (done = t) });
      client.start(sampleInput(3));
      const step = 1000 / fps;
      // 5 s at 1×, a 3 s pause, then the rest at 2×.
      for (; done < 0 && t < 60_000; t += step) {
        if (t >= 5000 && t < 8000) client.pause();
        else if (client.isPaused) {
          client.resume();
          client.setSpeed(2);
        }
        w.flush();
        client.update(t);
      }
      // 300 ticks: 100 at 1× (5 s), then 200 at 2× (5 s), plus the 3 s pause = 13 s.
      const expected = 5000 + 3000 + ((ROUND_TICKS - 100) * TICK_MS) / 2;
      expect(done, `${fps} fps`).toBeGreaterThanOrEqual(expected - 2 * step - 100);
      expect(done, `${fps} fps`).toBeLessThanOrEqual(expected + 2 * step + 200);
    }
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

  it('reports gridlock in the result for the Gridlock Drill jam mode', () => {
    const out: FromSimWorker[] = [];
    const h = createFakeWorkerHandler((m) => out.push(m));
    const jam = {
      ...input,
      districtRules: { ...input.districtRules, boss: 'gridlock-drill' as const },
    };
    h({ type: 'start', roundId: 1, input: jam });
    h({ type: 'finish', roundId: 1 });
    expect(out.at(-1)).toMatchObject({ type: 'done', result: { gridlocked: true } });
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

describe('waiting frames through the client (ADR-035)', () => {
  it('hands each frame its own tick’s per-edge waiting counts from the sim worker', () => {
    const w = memoryWorker(createSimWorkerHandler);
    const input = sampleInput(6);
    const lens: number[] = [];
    const client = new SimClient(w, {
      onFrame: (_f, _now, _c, waiting) => lens.push(waiting?.length ?? -1),
    });
    client.start(input);
    play(client, w, 0, 500);
    expect(lens.length).toBeGreaterThan(5);
    expect(new Set(lens)).toEqual(new Set([input.map.edges.length]));
  });

  it('sends the fake traffic’s held demand per edge, and the same at the end of the round', () => {
    const out: FromSimWorker[] = [];
    const h = createFakeWorkerHandler((m) => out.push(m));
    const jam = {
      ...sampleInput(3),
      districtRules: { ...sampleInput(3).districtRules, boss: 'gridlock-drill' as const },
    };
    h({ type: 'start', roundId: 1, input: jam });
    h({ type: 'finish', roundId: 1 });
    const frames = out.filter((m) => m.type === 'frames');
    const last = frames.at(-1);
    if (!last || last.type !== 'frames') throw new Error('no frames');
    expect(last.waiting).toHaveLength(last.frames.length);
    const final = [...(last.waiting?.at(-1) ?? [])];
    expect(final).toHaveLength(jam.map.edges.length);
    const done = out.at(-1);
    expect(done).toMatchObject({ type: 'done', result: { waiting: final, diverted: 0 } });
  });

  it('counts held demand events by edge, in map edge order', () => {
    const edges = [{ id: 7 }, { id: 2 }, { id: 9 }];
    const ev = (edge: number) => ({ tick: 0, edge, destinationEdge: 9, vehicleType: 0 });
    const frame = fakeWaitingFrame({ waiting: [ev(2), ev(2), ev(9), ev(5)] } as never, edges);
    expect([...frame]).toEqual([0, 2, 1]);
  });
});
