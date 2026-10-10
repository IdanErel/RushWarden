/**
 * Live throughput for the Go-phase bar (GDD §8 "throughput vs quota as a filling bar").
 * Snapshots carry no score, so the UI counts vehicles that leave the snapshot, weighted by the
 * §3 score values. The round result's throughput replaces it at the end (it includes card score
 * modifiers the snapshot cannot show).
 */
import { SNAPSHOT_HEADER, SNAPSHOT_STRIDE } from '@rushwarden/sim';
import { SCORE_VALUE } from '@rushwarden/render/core';

export class ExitCounter {
  private prev = new Map<number, number>();
  private next = new Map<number, number>();
  total = 0;

  reset(): void {
    this.prev.clear();
    this.total = 0;
  }

  /** Feeds the next released snapshot; returns the running total. */
  push(s: Uint16Array): number {
    this.next.clear();
    const n = Math.min(s[1] ?? 0, Math.floor((s.length - SNAPSHOT_HEADER) / SNAPSHOT_STRIDE));
    for (let i = 0; i < n; i++) {
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_STRIDE;
      this.next.set(s[o] ?? 0, s[o + 4] ?? 0);
    }
    for (const [id, type] of this.prev)
      if (!this.next.has(id)) this.total += SCORE_VALUE[type as keyof typeof SCORE_VALUE] ?? 1;
    [this.prev, this.next] = [this.next, this.prev];
    return this.total;
  }
}
