/**
 * Test hook H2 (docs/release/phase-1-test-plan.md §2.1): run state as `data-*` attributes on one
 * DOM node, plus H5's `data-target-rects`. Pure: builds the attribute map.
 */
import type { LiveIntersection } from '@rushwarden/render';
import type { Rect } from '@rushwarden/render/core';
import type { RunState } from './run/port.js';

export interface UiFlags {
  readonly speed: 1 | 2;
  readonly paused: boolean;
  /** Live throughput during Go; the result's afterwards. */
  readonly throughput: number;
  /** Valid targets of the selected card, keyed, in canvas-relative CSS px. */
  readonly targetRects: readonly (Rect & { readonly key: string })[];
  readonly selected: number | null;
  readonly cursor: number | null;
  /** Audio state: `none` (no sound surface), `idle` (no AudioContext yet) or `started`. */
  readonly audio?: 'none' | 'idle' | 'started';
  /** Sound muted (true with no sound surface). */
  readonly muted?: boolean;
  /** GDD §8 reduced-motion mode is on (E2E-17 checks it without a pixel diff). */
  readonly reducedMotion?: boolean;
  /** The scene's last decoded controllers frame (empty before the first Go frame). */
  readonly live?: readonly LiveIntersection[];
  /** Where the last round's gridlock started (the red ring), or null. */
  readonly gridlockOrigin?: { readonly x: number; readonly y: number } | null;
}

const xy = (t: { x: number; y: number }): string => `${t.x},${t.y}`;

export function stateAttributes(s: RunState, ui: UiFlags): Record<string, string> {
  return {
    'data-phase': s.phase,
    'data-round': String(s.round),
    'data-approval': String(s.approval),
    'data-energy': String(s.energy),
    'data-hand': s.hand.map((c) => c.id).join(','),
    'data-throughput': String(ui.throughput),
    'data-quota': String(s.quota),
    'data-speed': String(ui.speed),
    'data-paused': String(ui.paused),
    'data-round-hash': s.last?.hash ?? '',
    'data-placed': s.placed.map((p) => p.card.id).join(','),
    // Each placed card's segment as the sim gets it, `fx,fy>tx,ty` ('' for other targets).
    'data-placed-segments': s.placed
      .map((p) => (p.segment ? `${xy(p.segment.from)}>${xy(p.segment.to)}` : ''))
      .join(';'),
    'data-selected': ui.selected === null ? '' : String(ui.selected),
    'data-cursor': ui.cursor === null ? '' : String(ui.cursor),
    'data-target-rects': JSON.stringify(
      ui.targetRects.map((r) => ({
        key: r.key,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.w),
        h: Math.round(r.h),
      })),
    ),
    'data-history': s.history.join(','),
    'data-won': s.won === null ? '' : String(s.won),
    'data-audio': ui.audio ?? 'none',
    'data-muted': String(ui.muted ?? true),
    'data-reduced-motion': String(ui.reducedMotion ?? false),
    'data-gridlock-origin': ui.gridlockOrigin ? xy(ui.gridlockOrigin) : '',
    // Live controllers as `x,y:kind:greenSides:box` per intersection, e.g. `3,4:signal:ns:2`.
    'data-live': (ui.live ?? [])
      .map((l) => `${l.x},${l.y}:${l.kind}:${l.green.join('')}:${l.box}`)
      .join(' '),
  };
}
