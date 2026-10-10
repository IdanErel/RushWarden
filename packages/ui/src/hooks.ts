/**
 * Test hook H2 (docs/release/phase-1-test-plan.md §2.1): run state as `data-*` attributes on one
 * DOM node, plus H5's `data-target-rects`. Pure: builds the attribute map.
 */
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
}

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
  };
}
