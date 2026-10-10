/**
 * Worker-side handler for the renderer's fake traffic, speaking the shared sim worker protocol
 * (same messages, same roundId and step rules as `createSimWorkerHandler`). Dev page and tests
 * only. It also sends `controllers` frames (`fakeControllerFrame`) in the sim's layout.
 */
import {
  ControllerCode,
  SIGNAL_GREEN_TICKS,
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  buildWorld,
  type ControllerKind,
  type RoundInput,
  type RoundResult,
  type World,
} from '@rushwarden/sim';
import { CONTROLLER_STRIDE } from '../controller-state.js';
import { FakeTraffic, type FakeTrafficState } from '../fake-traffic.js';
import { decodeTileLane } from '../lanes.js';
import {
  MAX_TICKS_PER_STEP,
  type FromSimWorker,
  type PostFromWorker,
  type ToSimWorker,
} from './protocol.js';

function fakeResult(s: FakeTrafficState): RoundResult {
  return {
    throughput: s.throughput,
    spawned: s.spawned,
    exited: s.exited,
    ticks: s.tick,
    gridlocked: s.gridlocked,
    fundsDelta: 0,
    // Not a sim hash: the fake is not part of the determinism contract.
    finalHash: '0000000000000000',
  };
}

/** Ticks of all-red clearance between fake signal phases. */
export const FAKE_ALL_RED_TICKS = 4;

const CODE: Readonly<Record<ControllerKind, number>> = {
  uncontrolled: ControllerCode.Uncontrolled,
  signal: ControllerCode.Signal,
  roundabout: ControllerCode.Roundabout,
  'stop-all': ControllerCode.StopAll,
  priority: ControllerCode.Priority,
};

/**
 * Fake controller frames in the ADR-020 layout, so fake traffic shows the live readouts too: the
 * kind comes from the input's `setController` placements, a signal
 * alternates n-s and e-w green with an all-red gap, and the box count is the number of vehicles on
 * the intersection tile. Not the sim's controller model.
 */
export function fakeControllerFrame(
  input: Pick<RoundInput, 'placements'>,
  world: Pick<World, 'intersections'>,
  snapshot: Uint16Array,
): Uint8Array {
  const n = world.intersections.length;
  const out = new Uint8Array(n * CONTROLLER_STRIDE);
  const tick = snapshot[0] ?? 0;
  const count = snapshot[1] ?? 0;
  const box = new Map<string, number>();
  for (let k = 0, o = SNAPSHOT_HEADER; k < count; k++, o += SNAPSHOT_STRIDE) {
    const { x, y } = decodeTileLane(snapshot[o + 1] ?? 0);
    box.set(`${x},${y}`, (box.get(`${x},${y}`) ?? 0) + 1);
  }
  const span = SIGNAL_GREEN_TICKS + FAKE_ALL_RED_TICKS;
  const phase = Math.floor(tick / span) % 2;
  const green = tick % span < SIGNAL_GREEN_TICKS;
  for (let i = 0; i < n; i++) {
    const ix = world.intersections[i];
    if (!ix) continue;
    let kind: ControllerKind = 'uncontrolled';
    for (const p of input.placements) {
      if (p.target.kind !== 'intersection') continue;
      if (p.target.tile.x !== ix.x || p.target.tile.y !== ix.y) continue;
      for (const e of p.effects) if (e.kind === 'setController') kind = e.controller;
    }
    const o = i * CONTROLLER_STRIDE;
    out[o] = CODE[kind];
    out[o + 1] = kind === 'signal' && green ? (phase === 0 ? 0b0101 : 0b1010) : 0;
    out[o + 2] = Math.min(255, box.get(`${ix.x},${ix.y}`) ?? 0);
  }
  return out;
}

export function createFakeWorkerHandler(post: PostFromWorker): (msg: ToSimWorker) => void {
  let roundId = -1;
  let state: FakeTrafficState | null = null;
  let input: RoundInput | null = null;
  let world: Pick<World, 'intersections'> = { intersections: [] };

  const advance = (ticks: number): void => {
    if (!state) return;
    const frames: Uint16Array[] = [];
    const controllers: Uint8Array[] = [];
    while (!state.done && frames.length < ticks) {
      state = FakeTraffic.step(state);
      const f = FakeTraffic.snapshot(state);
      frames.push(f);
      if (input) controllers.push(fakeControllerFrame(input, world, f));
    }
    if (frames.length > 0) {
      const m: FromSimWorker = { type: 'frames', roundId, frames, controllers };
      post(m, [
        ...frames.map((f) => f.buffer as ArrayBuffer),
        ...controllers.map((c) => c.buffer as ArrayBuffer),
      ]);
    }
    if (state.done) {
      post({ type: 'done', roundId, result: fakeResult(state) }, []);
      state = null;
    }
  };

  return (msg) => {
    switch (msg.type) {
      case 'start':
        roundId = msg.roundId;
        input = msg.input;
        try {
          world = buildWorld(msg.input.map);
        } catch {
          world = { intersections: [] };
        }
        // Dev affordance: the "Gridlock Drill" boss runs the fake in jam mode, so the gridlock
        // effect can be seen through the normal `done` path.
        state = FakeTraffic.init(msg.input.map, msg.input.seed, {
          demand: msg.input.demandProfile,
          jam: msg.input.districtRules.boss === 'gridlock-drill',
        });
        return;
      case 'step':
        if (msg.roundId === roundId) advance(Math.max(0, Math.min(msg.ticks, MAX_TICKS_PER_STEP)));
        return;
      case 'finish':
        if (msg.roundId === roundId) while (state) advance(MAX_TICKS_PER_STEP);
        return;
      case 'abort':
        if (msg.roundId === roundId) state = null;
        return;
    }
  };
}
