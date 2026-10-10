import { SNAPSHOT_HEADER, SNAPSHOT_STRIDE } from '@rushwarden/sim';

/** Builds a snapshot from `[id, lane, cell, speed, type]` rows. */
export function snap(tick: number, rows: readonly (readonly number[])[]): Uint16Array {
  const out = new Uint16Array(SNAPSHOT_HEADER + rows.length * SNAPSHOT_STRIDE);
  out[0] = tick;
  out[1] = rows.length;
  rows.forEach((r, i) => out.set(r, SNAPSHOT_HEADER + i * SNAPSHOT_STRIDE));
  return out;
}

/** A controllable clock for the worker host. */
export class FakeClock {
  t = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  now = (): number => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown): void => {
    this.timers.delete(h as number);
  };
  /** Advances time, firing due timers in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let best: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!best || e[1].at < best[1].at)) best = e;
      if (!best) break;
      this.timers.delete(best[0]);
      this.t = best[1].at;
      best[1].fn();
    }
    this.t = end;
  }
}
