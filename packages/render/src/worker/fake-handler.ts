/**
 * Worker-side handler for the renderer's fake traffic, speaking the shared sim worker protocol
 * (same messages, same roundId and step rules as `createSimWorkerHandler`). Dev page and tests
 * only, until the sim spawns vehicles; then `fake.worker.ts` and this file are deleted.
 */
import type { RoundResult } from '@rushwarden/sim';
import { FakeTraffic, type FakeTrafficState } from '../fake-traffic.js';
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

export function createFakeWorkerHandler(post: PostFromWorker): (msg: ToSimWorker) => void {
  let roundId = -1;
  let state: FakeTrafficState | null = null;

  const advance = (ticks: number): void => {
    if (!state) return;
    const frames: Uint16Array[] = [];
    while (!state.done && frames.length < ticks) {
      state = FakeTraffic.step(state);
      frames.push(FakeTraffic.snapshot(state));
    }
    if (frames.length > 0) {
      const m: FromSimWorker = { type: 'frames', roundId, frames };
      post(
        m,
        frames.map((f) => f.buffer as ArrayBuffer),
      );
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
