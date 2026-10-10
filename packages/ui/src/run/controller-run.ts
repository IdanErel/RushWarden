/**
 * `RunPort` over the deterministic run controller (P1-BAL-01, `@rushwarden/app` run/). The Go
 * phase uses the controller's worker path: `roundInput()` goes to the sim worker, and the
 * worker's `RoundResult` comes back through `resolve(result)`. The controller emits the run
 * analytics events (`run_start`, `round_end`, `run_end`) to the `track()` it is given.
 *
 * The screens never see controller types: this adapter turns its state into the UI's `RunState`
 * and the renderer's `TargetMark`s into sim `Target`s.
 */
import {
  RunController,
  costOf,
  step,
  type DeckCard,
  type RoundOutcome as RunRoundOutcome,
  type RunAnalytics,
  type RunCard,
  type RunConfig,
  type RunEnv,
  type RunState as CtlState,
} from '@rushwarden/app';
import type { RoundInput, RoundResult, Target } from '@rushwarden/sim';
import { intersections, isIntersection, isRoad, type TargetMark } from '@rushwarden/render/core';
import { GRID_HEIGHT, GRID_WIDTH, type GridMap } from '@rushwarden/sim';
import type {
  PlacedCard,
  RoundMark,
  RoundOutcome,
  RunPort,
  RunState,
  TargetKind,
  UiCard,
} from './port.js';

/** Display text for a card, from content (CON-01: name, and text generated from effects). */
export interface CardInfo {
  readonly name: string;
  readonly text: string;
}

export type CardCatalog = (id: string, tier: 1 | 2) => CardInfo;

export interface ControllerRunOptions {
  readonly config: RunConfig;
  readonly env: RunEnv;
  readonly catalog: CardCatalog;
  /** Structurally the analytics client's `track()` (`createIngestClient`); null for none. */
  readonly analytics?: RunAnalytics | null;
}

/** GDD §5 district names, for the HUD and the share line. */
export const DISTRICT_NAME: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'Old Town',
  2: 'Midtown',
  3: 'Interchange',
};

/** §5 share glyph for a round: amber is a pass under 110% of quota, black a gridlock. */
export function markOf(o: {
  pass: boolean;
  gridlocked: boolean;
  throughput: number;
  quota: number;
}): RoundMark {
  if (o.gridlocked) return 'gridlock';
  if (!o.pass) return 'fail';
  return o.throughput * 10 < o.quota * 11 ? 'near' : 'pass';
}

/**
 * The straight run of non-intersection road tiles through (x, y), as a sim segment target. A
 * one-way card points from `from` to `to` (west to east, or north to south).
 */
export function segmentAt(map: GridMap, x: number, y: number): Target {
  const plain = (a: number, b: number): boolean => isRoad(map, a, b) && !isIntersection(map, a, b);
  const horizontal = plain(x - 1, y) || plain(x + 1, y) || !(plain(x, y - 1) || plain(x, y + 1));
  const [dx, dy] = horizontal ? [1, 0] : [0, 1];
  let [fx, fy] = [x, y];
  while (plain(fx - dx, fy - dy)) [fx, fy] = [fx - dx, fy - dy];
  let [tx, ty] = [x, y];
  while (plain(tx + dx, ty + dy)) [tx, ty] = [tx + dx, ty + dy];
  return { kind: 'segment', from: { x: fx, y: fy }, to: { x: tx, y: ty } };
}

export function toSimTarget(t: TargetMark, map: GridMap): Target {
  switch (t.kind) {
    case 'intersection':
      return { kind: 'intersection', tile: { x: t.x, y: t.y } };
    case 'segment':
      return segmentAt(map, t.x, t.y);
    case 'edge':
      return { kind: 'edge', edge: t.edge };
    case 'district':
      return { kind: 'district' };
  }
}

/** Every place a card of this target kind could go on the map, in a stable order. */
export function candidateTargets(kind: TargetKind, map: GridMap): TargetMark[] {
  switch (kind) {
    case 'intersection':
      return intersections(map).map(({ x, y }) => ({ kind: 'intersection', x, y }));
    case 'segment': {
      const out: TargetMark[] = [];
      for (let y = 0; y < GRID_HEIGHT; y++)
        for (let x = 0; x < GRID_WIDTH; x++)
          if (isRoad(map, x, y) && !isIntersection(map, x, y)) out.push({ kind: 'segment', x, y });
      return out;
    }
    case 'edge':
      return [...map.edges].sort((a, b) => a.id - b.id).map((e) => ({ kind: 'edge', edge: e.id }));
    case 'district':
      return [{ kind: 'district' }];
  }
}

function controllerOf(card: RunCard): UiCard['controller'] {
  for (const e of card.effects) if (e.kind === 'setController') return e.controller;
  return undefined;
}

export class ControllerRun implements RunPort {
  private ctl: RunController;
  private seed: number;
  private going = false;
  private readonly cards: ReadonlyMap<string, RunCard>;
  /** The map mark each play was made on, by deck uid (the sim target loses the tapped tile). */
  private readonly marks = new Map<number, TargetMark>();
  private cache: { from: CtlState; going: boolean; ui: RunState } | null = null;

  constructor(private readonly opts: ControllerRunOptions) {
    this.seed = opts.config.seed >>> 0;
    this.cards = new Map(opts.config.cards.map((c) => [c.id, c]));
    this.ctl = this.make();
  }

  /** The controller, e.g. to save its action log. */
  get controller(): RunController {
    return this.ctl;
  }

  private make(): RunController {
    return new RunController(
      { ...this.opts.config, seed: this.seed },
      this.opts.env,
      this.opts.analytics ?? null,
    );
  }

  private card(d: DeckCard, s: CtlState): UiCard {
    const def = this.cards.get(d.id);
    if (!def) throw new Error(`unknown card ${d.id}`);
    const info = this.opts.catalog(d.id, d.tier);
    const controller = controllerOf(def);
    return {
      id: d.id,
      name: info.name,
      text: info.text,
      cost: costOf(s, d),
      target: def.target,
      tags: def.tags,
      tier: d.tier,
      ...(controller ? { controller } : {}),
    };
  }

  state(): RunState {
    const s = this.ctl.state;
    if (this.cache && this.cache.from === s && this.cache.going === this.going)
      return this.cache.ui;
    const cfg = s.config;
    const last: RunRoundOutcome | undefined = s.history[s.history.length - 1];
    const paid = s.plays.reduce((n, p) => n + (p.refunded ? 0 : p.paid), 0);
    const placed: PlacedCard[] = s.plays.map((p) => ({
      card: this.card(p.card, s),
      target: this.marks.get(p.card.uid) ?? { kind: 'district' },
    }));
    const ui: RunState = {
      phase: s.phase === 'place' && this.going ? 'go' : s.phase,
      round: s.round,
      rounds: cfg.rounds,
      rush: s.rush,
      quota: s.quota,
      approval: s.approval,
      maxApproval: cfg.approval,
      energy: s.energy,
      maxEnergy: Math.max(cfg.energy, s.energy + paid),
      playsLeft: Math.max(0, cfg.maxPlays - s.plays.length),
      funds: s.funds,
      district: DISTRICT_NAME[cfg.district],
      hand: s.hand.map((d) => this.card(d, s)),
      placed,
      offer: s.offer ? s.offer.map((d) => this.card(d, s)) : null,
      last: last ? outcomeOf(last) : null,
      history: s.history.map(markOf),
      won: s.outcome === null ? null : s.outcome === 'win',
      totalThroughput: s.history.reduce((n, o) => n + o.throughput, 0),
    };
    this.cache = { from: s, going: this.going, ui };
    return ui;
  }

  targets(handIndex: number): readonly TargetMark[] {
    const s = this.ctl.state;
    const d = s.hand[handIndex];
    const def = d && this.cards.get(d.id);
    if (this.going || s.phase !== 'place' || !def) return [];
    // The controller is the rules: offer exactly the targets it would accept.
    return candidateTargets(def.target, s.map).filter(
      (t) => step(s, { type: 'play', handIndex, target: toSimTarget(t, s.map) }, this.opts.env).ok,
    );
  }

  place(handIndex: number, target: TargetMark): void {
    const s = this.ctl.state;
    const d = s.hand[handIndex];
    if (!d || this.going) throw new Error('invalid placement');
    const r = this.ctl.dispatch({ type: 'play', handIndex, target: toSimTarget(target, s.map) });
    if (!r.ok) throw new Error(r.error);
    this.marks.set(d.uid, target);
  }

  canUndo(placedIndex: number): boolean {
    const s = this.ctl.state;
    if (this.going || s.phase !== 'place' || !s.plays[placedIndex]) return false;
    // One controller undo per later play, back to and including this one. A redraw clears the
    // controller's undo stack (ADR-018 point 8), so plays before it cannot be reached.
    return s.undoStack.length >= s.plays.length - placedIndex;
  }

  /**
   * Takes back play `placedIndex`. The controller undoes the last play only, so later plays are
   * undone too and then replayed on the same targets. Refused (no change) when `!canUndo`.
   */
  undo(placedIndex: number): void {
    if (!this.canUndo(placedIndex)) return;
    const s = this.ctl.state;
    const later = s.plays.slice(placedIndex + 1).map((p) => p.card.uid);
    for (let n = s.plays.length; n > placedIndex; n--) {
      const r = this.ctl.dispatch({ type: 'undo' });
      if (!r.ok) throw new Error(r.error);
    }
    this.marks.delete(s.plays[placedIndex]?.card.uid ?? -1);
    for (const uid of later) {
      const mark = this.marks.get(uid);
      const now = this.ctl.state;
      const handIndex = now.hand.findIndex((c) => c.uid === uid);
      if (!mark || handIndex < 0) continue;
      const r = this.ctl.dispatch({
        type: 'play',
        handIndex,
        target: toSimTarget(mark, now.map),
      });
      if (!r.ok) this.marks.delete(uid);
    }
  }

  roundInput(): RoundInput {
    return this.ctl.roundInput();
  }

  go(): void {
    if (this.ctl.state.phase === 'place') this.going = true;
  }

  finishRound(result: RoundResult): void {
    if (!this.going) return;
    this.going = false;
    const r = this.ctl.resolve(result);
    if (!r.ok) throw new Error(r.error);
    this.marks.clear();
  }

  pickOffer(i: number | null): void {
    const s = this.ctl.state;
    if (s.phase !== 'result' || !s.offer) return;
    this.ctl.dispatch({ type: 'choose', pick: i === null ? 'skip' : i });
  }

  next(): void {
    const s = this.ctl.state;
    if (s.phase === 'result' && !s.offer) this.ctl.dispatch({ type: 'choose', pick: 'skip' });
  }

  retry(): void {
    this.seed = (this.seed + 1) >>> 0;
    this.going = false;
    this.marks.clear();
    this.cache = null;
    this.ctl = this.make();
  }

  /** The current run's seed (changes on retry). */
  get runSeed(): number {
    return this.seed;
  }
}

function outcomeOf(o: RunRoundOutcome): RoundOutcome {
  return {
    round: o.round,
    pass: o.pass,
    throughput: o.throughput,
    quota: o.quota,
    gridlocked: o.gridlocked,
    fundsEarned: o.fundsEarned,
    approvalLost: o.pass ? 0 : 1,
    hash: o.finalHash,
  };
}
