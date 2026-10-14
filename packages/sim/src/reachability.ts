import { placementError } from './placements.js';
import { init, trafficOf } from './sim.js';
import type { Placement, RoundInput } from './types.js';
import { VEHICLE_TYPE_COUNT } from './vehicles.js';
import { route } from './world.js';

/** One edge-to-edge trip a placement would leave without a route (map edge ids). */
export interface RouteCut {
  readonly vehicleType: number;
  readonly from: number;
  readonly to: number;
}

/** What placing a card would cut off this round (ADR-035). */
export interface CutReport {
  /** Every (type, from, to) reachable before the placement and unreachable after it. */
  readonly cuts: readonly RouteCut[];
  /** Map edge ids that lose at least one route to them (from some origin, for some type), ascending. */
  readonly exits: readonly number[];
  /** Map edge ids from which some type could reach an exit before and now reaches none, ascending. */
  readonly entries: readonly number[];
}

/** reach[(type * e + from) * e + to] = 1 when a route exists this round. */
function reachability(input: RoundInput): Uint8Array {
  const t = trafficOf(init({ ...input, demandProfile: [], recordFrames: false }));
  const w = t.world;
  const e = w.edges.length;
  const out = new Uint8Array(VEHICLE_TYPE_COUNT * e * e);
  for (let vt = 0; vt < VEHICLE_TYPE_COUNT; vt++) {
    const mask = t.routeMask[vt] ?? t.closed;
    for (let a = 0; a < e; a++)
      for (let b = 0; b < e; b++)
        if (a !== b && route(w, a, b, mask)) out[(vt * e + a) * e + b] = 1;
  }
  return out;
}

/**
 * The trips `candidate` would cut off if added to this round's placements: for the run screen's
 * ghost ("cuts off the north-west exits") before One-Way, Bus Lane or No Heavy is placed. Pure and
 * cheap (two BFS sweeps over the round's edge pairs per vehicle type). Returns null when the
 * candidate is not a valid placement on this map (`placementError` says why).
 */
export function cutRoutes(input: RoundInput, candidate: Placement): CutReport | null {
  if (placementError(input.map, candidate) !== null) return null;
  const before = reachability(input);
  const after = reachability({ ...input, placements: [...input.placements, candidate] });
  const ids = input.map.edges.map((edge) => edge.id);
  const e = ids.length;
  const cuts: RouteCut[] = [];
  const exits = new Set<number>();
  const entries = new Set<number>();
  for (let vt = 0; vt < VEHICLE_TYPE_COUNT; vt++) {
    for (let a = 0; a < e; a++) {
      let couldLeave = false;
      let canLeave = false;
      for (let b = 0; b < e; b++) {
        const k = (vt * e + a) * e + b;
        if (before[k]) couldLeave = true;
        if (after[k]) canLeave = true;
        if (before[k] && !after[k]) {
          cuts.push({ vehicleType: vt, from: ids[a]!, to: ids[b]! });
          exits.add(ids[b]!);
        }
      }
      if (couldLeave && !canLeave) entries.add(ids[a]!);
    }
  }
  const sorted = (s: Set<number>) => [...s].sort((x, y) => x - y);
  return { cuts, exits: sorted(exits), entries: sorted(entries) };
}
