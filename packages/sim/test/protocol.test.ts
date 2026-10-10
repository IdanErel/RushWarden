import { describe, expect, it } from 'vitest';
import {
  MAX_TICKS_PER_STEP,
  ROUND_TICKS,
  Sim,
  buildWorld,
  controllerSnapshot,
  createSimWorkerHandler,
  denseInput,
  sampleInput,
  type FromSimWorker,
} from '../src/index.js';

function harness() {
  const out: { msg: FromSimWorker; transfer: ArrayBuffer[] }[] = [];
  const handle = createSimWorkerHandler((msg, transfer) => out.push({ msg, transfer }));
  return { out, handle };
}

describe('sim worker protocol', () => {
  it('streams frames that equal a headless recorded run, then done with the same result', () => {
    const input = sampleInput(11);
    const { out, handle } = harness();
    handle({ type: 'start', roundId: 1, input });
    for (let i = 0; i < 20; i++) handle({ type: 'step', roundId: 1, ticks: 20 });
    const frames = out.flatMap((o) => (o.msg.type === 'frames' ? o.msg.frames : []));
    const headless = Sim.simulate({ ...input, recordFrames: true });
    expect(frames).toEqual(headless.frames);
    const done = out.filter((o) => o.msg.type === 'done');
    expect(done).toHaveLength(1);
    const { frames: _f, ...expected } = headless;
    expect(done[0]!.msg).toEqual({ type: 'done', roundId: 1, result: expected });
  });

  it('transfers each frame and controller buffer', () => {
    const { out, handle } = harness();
    handle({ type: 'start', roundId: 2, input: sampleInput(1) });
    handle({ type: 'step', roundId: 2, ticks: 3 });
    const first = out[0]!;
    expect(first.msg.type).toBe('frames');
    expect(first.transfer).toHaveLength(6);
  });

  it('sends controllerSnapshot per frame, equal to stepping headless (ADR-020)', () => {
    const input = denseInput(5);
    const { out, handle } = harness();
    handle({ type: 'start', roundId: 4, input });
    handle({ type: 'finish', roundId: 4 });
    const msgs = out.flatMap((o) => (o.msg.type === 'frames' ? [o.msg] : []));
    const controllers = msgs.flatMap((m) => m.controllers ?? []);
    expect(msgs.every((m) => m.controllers?.length === m.frames.length)).toBe(true);
    expect(controllers).toHaveLength(ROUND_TICKS);
    let s = Sim.init(input);
    const expected: Uint8Array[] = [];
    while (!s.done) {
      s = Sim.step(s);
      expected.push(controllerSnapshot(s));
    }
    expect(controllers).toEqual(expected);
    // Every intersection is uncontrolled until P1-SIM-05 wires the cards; box counts still move.
    expect(controllers[0]!.length).toBe(buildWorld(input.map).intersections.length * 3);
    expect(controllers.every((c) => c.every((v, k) => k % 3 === 2 || v === 0))).toBe(true);
    expect(controllers.some((c) => c.some((v, k) => k % 3 === 2 && v > 0))).toBe(true);
  });

  it('caps ticks per step, ignores stale rounds, supports finish and abort', () => {
    const { out, handle } = harness();
    handle({ type: 'start', roundId: 3, input: sampleInput(2) });
    handle({ type: 'step', roundId: 3, ticks: 1000 });
    const m = out[0]!.msg;
    expect(m.type === 'frames' && m.frames.length).toBe(MAX_TICKS_PER_STEP);
    handle({ type: 'step', roundId: 99, ticks: 5 });
    expect(out).toHaveLength(1);
    handle({ type: 'finish', roundId: 3 });
    const total = out.flatMap((o) => (o.msg.type === 'frames' ? o.msg.frames : [])).length;
    expect(total).toBe(ROUND_TICKS);
    expect(out.at(-1)!.msg.type).toBe('done');
    handle({ type: 'start', roundId: 4, input: sampleInput(3) });
    handle({ type: 'abort', roundId: 4 });
    handle({ type: 'step', roundId: 4, ticks: 5 });
    handle({ type: 'abort', roundId: 99 });
    expect(out.at(-1)!.msg.type).toBe('done');
  });

  it('reports bad input as an error message', () => {
    const { out, handle } = harness();
    handle({ type: 'start', roundId: 5, input: { ...sampleInput(1), seed: -1 } });
    expect(out[0]!.msg).toEqual({
      type: 'error',
      roundId: 5,
      message: expect.stringContaining('seed'),
    });
  });
});
