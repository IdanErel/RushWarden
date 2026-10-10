/**
 * Card effects (GDD section 4; P1-SIM-05; ADR-023). Placements are resolved (stacking and
 * controller conflicts), then applied in three stages before the first tick:
 *
 * 1. Topology (`setOneWay`, `setLaneCount`) becomes lane overrides for the round's world.
 * 2. Demand (`spawnModifier`, `reroute`, `spawnWindow`, `smoothDemand`) transforms the demand
 *    profile. Selection is by an integer error-diffusion count, never by randomness, so "50% of
 *    spawns" is exactly every second matching spawn.
 * 3. Everything else configures the round's `Traffic` (controllers, speed caps, bans, ...).
 *
 * Run-controller effects (`drawModifier`, `energyModifier`, `costModifier`, `redraw`, and
 * `fundsModifier` without a segment toll) travel in placements and are ignored here.
 */
import {
  configureSignal,
  PocketMode,
  setController,
  setResolveTicks,
  setTurnPockets,
  UNCONTROLLED_RESOLVE_TICKS,
} from './controllers.js';
import { clamp, idiv } from './math.js';
import { segmentTiles } from './placements.js';
import { VMAX, type Traffic } from './traffic.js';
import {
  DEFAULT_SWITCH_TICKS,
  GRID_HEIGHT,
  GRID_WIDTH,
  ROUND_TICKS,
  type ControllerKind,
  type DemandEvent,
  type DemandProfile,
  type Effect,
  type GridMap,
  type Placement,
  type Target,
  type TileRef,
} from './types.js';
import { BUS_DWELL_TICKS, VEHICLE_TYPE_COUNT } from './vehicles.js';
import { opposite, sideIndex, type LaneOverride, type World } from './world.js';

const NONE = -1;
const ALL_TYPES = (1 << VEHICLE_TYPE_COUNT) - 1;
/** Ticks per demand bin for `smoothDemand` (one sim second). */
const BIN_TICKS = 20;

// ---------------------------------------------------------------------------------------------
// Resolution: stacking and controller conflicts
// ---------------------------------------------------------------------------------------------

/** The outcome of `resolvePlacements`, for the sim and the run controller. */
export interface PlacementResolution {
  /** Placements that take effect, in application order: run effects, then by `order`. */
  readonly applied: readonly Placement[];
  /** Placements that lost a controller conflict: "the last played wins and the earlier card is refunded". */
  readonly refunded: readonly Placement[];
  /** Placements that repeat the same card on the same target: "same card on same target does not stack". */
  readonly ignored: readonly Placement[];
  /**
   * For each applied placement with `setController`: the intersection's controller before this
   * round's cards (the map default after run effects). Remove Signal's refund needs `'signal'`.
   */
  readonly replacedController: ReadonlyMap<Placement, ControllerKind>;
}

function tileKey(t: TileRef): string {
  return `${t.x},${t.y}`;
}

function targetKey(t: Target): string {
  switch (t.kind) {
    case 'intersection':
      return `i:${tileKey(t.tile)}`;
    case 'segment': {
      // A segment and its reverse are the same target.
      const a = tileKey(t.from);
      const b = tileKey(t.to);
      return a < b ? `s:${a}:${b}` : `s:${b}:${a}`;
    }
    case 'edge':
      return `e:${t.edge}`;
    case 'district':
      return 'd';
  }
}

function controllerEffect(p: Placement): Extract<Effect, { kind: 'setController' }> | undefined {
  return p.effects.find(
    (e): e is Extract<Effect, { kind: 'setController' }> => e.kind === 'setController',
  );
}

/**
 * Applies the GDD section 4 stacking rules. Run effects come first and are never refunded; this
 * round's placements follow in `order` (ties keep array order). A placement repeating an earlier
 * card on the same target is ignored. When two of this round's placements set the controller of
 * the same intersection, the later one wins and the earlier one is refunded whole.
 */
export function resolvePlacements(
  runEffects: readonly Placement[],
  placements: readonly Placement[],
): PlacementResolution {
  const sorted = placements
    .map((p, i) => [p, i] as const)
    .sort((a, b) => a[0].order - b[0].order || a[1] - b[1])
    .map(([p]) => p);
  const seen = new Set<string>();
  const ignored: Placement[] = [];
  const kept: Placement[] = [];
  const keptRound = new Set<Placement>();
  for (const p of [...runEffects, ...sorted]) {
    const key = `${p.cardId}|${targetKey(p.target)}`;
    if (seen.has(key)) {
      ignored.push(p);
      continue;
    }
    seen.add(key);
    kept.push(p);
  }
  for (const p of sorted) keptRound.add(p);
  // Controller before this round's cards, per intersection: map default, then run effects.
  const before = new Map<string, ControllerKind>();
  const lastController = new Map<string, Placement>();
  for (const p of kept) {
    const c = controllerEffect(p);
    if (!c) continue;
    const key = targetKey(p.target);
    if (!keptRound.has(p)) before.set(key, c.controller);
    else lastController.set(key, p);
  }
  const refunded: Placement[] = [];
  const applied: Placement[] = [];
  const replacedController = new Map<Placement, ControllerKind>();
  for (const p of kept) {
    const c = controllerEffect(p);
    if (c && keptRound.has(p)) {
      const key = targetKey(p.target);
      if (lastController.get(key) !== p) {
        refunded.push(p);
        continue;
      }
      replacedController.set(p, before.get(key) ?? 'uncontrolled');
    }
    applied.push(p);
  }
  return { applied, refunded, ignored, replacedController };
}

// ---------------------------------------------------------------------------------------------
// Phase 1 support
// ---------------------------------------------------------------------------------------------

/**
 * Why an effect cannot be applied by this sim yet, or null. These are primitives or forms no
 * Phase 1 card uses; rejecting them keeps card text from promising what the sim does not do.
 */
export function unsupportedEffect(p: Placement, e: Effect): string | null {
  const k = p.target.kind;
  switch (e.kind) {
    case 'setController':
      return k === 'intersection' ? null : 'setController needs an intersection target';
    case 'setSignalPhase':
      if (e.mode !== 'adaptive') return `setSignalPhase mode '${e.mode}' is not implemented yet`;
      return k === 'intersection' ? null : 'setSignalPhase needs an intersection target';
    case 'addTurnLane':
    case 'preferType':
      return k === 'intersection' ? null : `${e.kind} needs an intersection target`;
    case 'setSpeedLimit':
    case 'reserveLane':
    case 'addBikeLane':
    case 'setOneWay':
    case 'setBusStopDwell':
      return k === 'segment' ? null : `${e.kind} needs a segment target`;
    case 'setLaneCount':
      if (e.scope === 'ring') return null;
      return k === 'segment' ? null : 'setLaneCount needs a segment target or ring scope';
    case 'banType':
      if (typeof e.scope === 'object') return null;
      return k === 'segment' ? null : 'banType needs a segment target or a road-class scope';
    case 'reroute':
      return k === 'edge' ? null : 'reroute needs an edge target';
    case 'spawnModifier':
      return k === 'district' || k === 'edge'
        ? null
        : 'spawnModifier needs a district or edge target';
    case 'scoreModifier':
      return e.condition === undefined
        ? null
        : `scoreModifier condition '${e.condition}' is not implemented yet`;
    default:
      return null;
  }
}

/** Throws a `RangeError` naming the card for the first unsupported effect (see `unsupportedEffect`). */
export function checkSupported(applied: readonly Placement[]): void {
  for (const p of applied) {
    for (const e of p.effects) {
      const why = unsupportedEffect(p, e);
      if (why) throw new RangeError(`card "${p.cardId}": ${why}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

function tilesOf(t: Target): number[] {
  if (t.kind !== 'segment') return [];
  return (segmentTiles(t) ?? []).map((r) => r.y * GRID_WIDTH + r.x);
}

/** Travel direction along a segment from `from` to `to` (n, e, s, w = 0..3), or -1 for one tile. */
function segmentDir(t: Extract<Target, { kind: 'segment' }>): number {
  if (t.to.x > t.from.x) return 1;
  if (t.to.x < t.from.x) return 3;
  if (t.to.y > t.from.y) return 2;
  if (t.to.y < t.from.y) return 0;
  return NONE;
}

/** Links holding any of `tiles`. */
function linksThrough(world: World, tiles: readonly number[]): number[] {
  const set = new Set(tiles);
  return world.links.filter((l) => l.tiles.some((x) => set.has(x))).map((l) => l.id);
}

/** Flat lane cells of `link`'s lanes on `tiles`, in travel order, per lane. */
function cellsOn(world: World, link: number, tiles: ReadonlySet<number>): number[][] {
  const l = world.links[link]!;
  return l.lanes.map((lane) => {
    const out: number[] = [];
    for (let c = 0; c < l.cells; c++) {
      if (tiles.has(l.tiles[c >> 2]!)) out.push(world.laneCellBase[lane]! + c);
    }
    return out;
  });
}

function intersectionAt(world: World, t: Target): number {
  if (t.kind !== 'intersection') return NONE;
  const tile = t.tile.y * GRID_WIDTH + t.tile.x;
  const ix = world.intersections.findIndex((n) => n.tile === tile);
  if (ix === NONE) throw new RangeError(`no intersection at (${t.tile.x}, ${t.tile.y})`);
  return ix;
}

function typeMask(types: readonly number[] | undefined): number {
  if (!types) return ALL_TYPES;
  let m = 0;
  for (const v of types) m |= 1 << v;
  return m;
}

/** Map lanes per direction of a tile (1 = local, 2+ = arterial; ADR-014 point 9). */
function mapLanes(map: GridMap, tile: number): number {
  const t = map.tiles[tile];
  return t?.kind === 'road' ? t.lanes : 0;
}

// ---------------------------------------------------------------------------------------------
// Stage 1: topology
// ---------------------------------------------------------------------------------------------

/** Lane overrides for the round's world from `setOneWay` and `setLaneCount`, in play order. */
export function laneOverrides(map: GridMap, applied: readonly Placement[]): LaneOverride[] {
  const out: LaneOverride[] = [];
  const current = new Map<number, number>(); // tile * 4 + dir -> lanes so far
  const lanesAt = (tile: number, dir: number): number =>
    current.get(tile * 4 + dir) ?? mapLanes(map, tile);
  const set = (tile: number, dir: number, lanes: number): void => {
    current.set(tile * 4 + dir, lanes);
    out.push({ tile, dir, lanes });
  };
  for (const p of applied) {
    for (const e of p.effects) {
      if (e.kind === 'setOneWay' && p.target.kind === 'segment') {
        const along = segmentDir(p.target);
        const dir = e.direction !== undefined ? sideIndex(e.direction) : along;
        if (dir === NONE) throw new RangeError('setOneWay on one tile needs a direction');
        if (along !== NONE && (dir & 1) !== (along & 1))
          throw new RangeError('setOneWay direction must run along the segment');
        for (const tile of tilesOf(p.target)) {
          const lanes = lanesAt(tile, dir);
          set(tile, dir, e.doubleLanes ? Math.min(4, lanes + lanesAt(tile, opposite(dir))) : lanes);
          set(tile, opposite(dir), 0);
        }
      } else if (e.kind === 'setLaneCount') {
        const tiles =
          e.scope === 'ring'
            ? map.tiles.flatMap((t, i) => (t.kind === 'road' && t.ring === true ? [i] : []))
            : tilesOf(p.target);
        for (const tile of tiles) for (let dir = 0; dir < 4; dir++) set(tile, dir, e.lanes);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Stage 2: demand
// ---------------------------------------------------------------------------------------------

/** Error-diffusion selection: how many of item `k` to pick at `percent` (0..100+). */
function picks(k: number, percent: number): number {
  return idiv((k + 1) * percent, 100) - idiv(k * percent, 100);
}

/** Map edge ids in clockwise order along the boundary (n left to right, e top to bottom, ...). */
function clockwise(map: GridMap): number[] {
  const pos = (e: GridMap['edges'][number]): number => {
    const { x, y } = e.tile;
    switch (e.side) {
      case 'n':
        return x;
      case 'e':
        return GRID_WIDTH + y;
      case 's':
        return GRID_WIDTH + GRID_HEIGHT + (GRID_WIDTH - 1 - x);
      case 'w':
        return 2 * GRID_WIDTH + GRID_HEIGHT + (GRID_HEIGHT - 1 - y);
    }
  };
  return [...map.edges].sort((a, b) => pos(a) - pos(b)).map((e) => e.id);
}

/** Applies the demand effects in play order; the result is sorted by (tick, edge). */
export function transformDemand(
  map: GridMap,
  demand: DemandProfile,
  applied: readonly Placement[],
): DemandProfile {
  let d: DemandEvent[] = [...demand];
  let changed = false;
  const order = clockwise(map);
  for (const p of applied) {
    for (const e of p.effects) {
      switch (e.kind) {
        case 'spawnModifier': {
          const edge = p.target.kind === 'edge' ? p.target.edge : null;
          const next: DemandEvent[] = [];
          let k = 0;
          for (const ev of d) {
            if (ev.vehicleType !== e.vehicleType || (edge !== null && ev.edge !== edge)) {
              next.push(ev);
              continue;
            }
            if (e.percent < 0) {
              if (picks(k, -e.percent) === 0) next.push(ev);
            } else {
              next.push(ev);
              for (let c = picks(k, e.percent); c > 0; c--) next.push(ev);
            }
            k++;
          }
          d = next;
          changed = true;
          break;
        }
        case 'reroute': {
          if (p.target.kind !== 'edge') break;
          const from = p.target.edge;
          const to =
            e.to === 'secondary' && p.secondaryTarget?.kind === 'edge'
              ? p.secondaryTarget.edge
              : order[(order.indexOf(from) + 1) % order.length]!;
          const types = typeMask(e.vehicleTypes);
          let k = 0;
          d = d.map((ev) => {
            if (ev.edge !== from || !(types & (1 << ev.vehicleType))) return ev;
            const pick = picks(k++, e.percent) > 0;
            return pick && to !== ev.destinationEdge ? { ...ev, edge: to } : ev;
          });
          changed = true;
          break;
        }
        case 'spawnWindow': {
          const span = e.toTick - e.fromTick;
          d = d.map((ev) =>
            ev.vehicleType === e.vehicleType
              ? { ...ev, tick: e.fromTick + idiv(ev.tick * span, ROUND_TICKS) }
              : ev,
          );
          changed = true;
          break;
        }
        case 'smoothDemand':
          d = smooth(d, e.peakPermille);
          changed = true;
          break;
        default:
          break;
      }
    }
  }
  if (!changed) return demand;
  return d
    .map((ev, i) => [ev, i] as const)
    .sort((a, b) => a[0].tick - b[0].tick || a[0].edge - b[0].edge || a[1] - b[1])
    .map(([ev]) => ev);
}

/**
 * Staggered Hours: the busiest second's spawn count drops by `peakPermille`, and the excess moves
 * to the next seconds with room (then earlier ones), keeping each spawn's tick within its second.
 */
function smooth(demand: DemandEvent[], peakPermille: number): DemandEvent[] {
  const bins = idiv(ROUND_TICKS, BIN_TICKS);
  const byBin: DemandEvent[][] = Array.from({ length: bins }, () => []);
  for (const ev of [...demand].sort((a, b) => a.tick - b.tick || a.edge - b.edge))
    byBin[Math.min(bins - 1, idiv(ev.tick, BIN_TICKS))]!.push(ev);
  const peak = Math.max(...byBin.map((b) => b.length));
  const cap = Math.max(1, peak - idiv(peak * peakPermille, 1000));
  const moveTo = (ev: DemandEvent, bin: number): DemandEvent => ({
    ...ev,
    tick: bin * BIN_TICKS + (ev.tick % BIN_TICKS),
  });
  let carry: DemandEvent[] = [];
  for (let b = 0; b < bins; b++) {
    const here = byBin[b]!;
    // Earlier carried spawns go first, then this second's own, latest overflowing.
    const all = [...carry.map((ev) => moveTo(ev, b)), ...here];
    byBin[b] = all.slice(0, cap);
    carry = all.slice(cap);
  }
  for (let b = bins - 1; b >= 0 && carry.length > 0; b--) {
    const room = cap - byBin[b]!.length;
    if (room <= 0) continue;
    byBin[b]!.push(...carry.splice(0, room).map((ev) => moveTo(ev, b)));
  }
  if (carry.length > 0) byBin[bins - 1]!.push(...carry); // more demand than the capped round holds
  return byBin.flat();
}

// ---------------------------------------------------------------------------------------------
// Stage 3: traffic
// ---------------------------------------------------------------------------------------------

/** A toll from `fundsModifier { delta, per }` on a segment (Toll Booth). */
export interface Toll {
  readonly delta: number;
  readonly per: number;
}

/** Configures `t` from the applied placements. Returns the tolls, indexed as in `t.tollOf`. */
export function configureTraffic(
  t: Traffic,
  map: GridMap,
  applied: readonly Placement[],
  basePSlow: number,
): Toll[] {
  const w = t.world;
  const flatCells = w.laneCellBase[w.lanes.length]!;
  let pSlow = basePSlow;
  let fasterTicks = 0;
  const tolls: Toll[] = [];
  const mask = (vt: number): Uint8Array => {
    let m = t.routeMask[vt] ?? null;
    if (!m) {
      m = t.closed ? Uint8Array.from(t.closed) : new Uint8Array(w.links.length);
      t.routeMask[vt] = m;
    }
    return m;
  };
  const speedCap = (): Uint8Array => {
    if (!t.speedCap) {
      const cap = new Uint8Array(flatCells * VEHICLE_TYPE_COUNT);
      for (let f = 0; f < flatCells; f++)
        for (let vt = 0; vt < VEHICLE_TYPE_COUNT; vt++)
          cap[f * VEHICLE_TYPE_COUNT + vt] = VMAX[vt]!;
      t.speedCap = cap;
    }
    return t.speedCap;
  };
  for (const p of applied) {
    const tiles = tilesOf(p.target);
    const tileSet = new Set(tiles);
    for (const e of p.effects) {
      switch (e.kind) {
        case 'setController': {
          const opts: { direction?: typeof e.direction; capacity?: number } = {};
          if (e.direction !== undefined) opts.direction = e.direction;
          if (e.capacity !== undefined) opts.capacity = e.capacity;
          setController(t, intersectionAt(w, p.target), e.controller, opts);
          break;
        }
        case 'setSignalPhase': {
          const ticks = e.switchTicks ?? DEFAULT_SWITCH_TICKS + (e.switchTicksDelta ?? 0);
          configureSignal(t, intersectionAt(w, p.target), true, clamp(ticks, 0, 255));
          break;
        }
        case 'addTurnLane':
          setTurnPockets(
            t,
            intersectionAt(w, p.target),
            e.turns === 'both' ? PocketMode.Both : PocketMode.Left,
          );
          break;
        case 'preferType': {
          t.preferMask ??= new Uint8Array(w.intersections.length);
          const ix = intersectionAt(w, p.target);
          t.preferMask[ix] = t.preferMask[ix]! | typeMask([e.vehicleType, ...(e.alsoTypes ?? [])]);
          break;
        }
        case 'yieldRule':
          fasterTicks += e.fasterTicks;
          break;
        case 'setPSlow':
          pSlow = clamp(pSlow + e.deltaPermille, 0, 1000);
          break;
        case 'setBusStopDwell': {
          t.dwellAt ??= new Uint8Array(flatCells).fill(BUS_DWELL_TICKS);
          for (const link of linksThrough(w, tiles))
            for (const cells of cellsOn(w, link, tileSet))
              for (const f of cells)
                if (w.stopCell[f] === 1) t.dwellAt[f] = clamp(e.dwellTicks, 0, 255);
          break;
        }
        case 'setSpeedLimit': {
          const cap = speedCap();
          const types = typeMask(e.types);
          for (const link of linksThrough(w, tiles)) {
            for (const cells of cellsOn(w, link, tileSet)) {
              const span = e.cells === undefined ? cells : cells.slice(0, e.cells);
              for (const f of span) {
                for (let vt = 0; vt < VEHICLE_TYPE_COUNT; vt++) {
                  if (!(types & (1 << vt))) continue;
                  const i = f * VEHICLE_TYPE_COUNT + vt;
                  cap[i] = clamp(Math.min(cap[i]! + e.delta, e.max ?? 15), 0, 15);
                }
              }
            }
          }
          break;
        }
        case 'addBikeLane': {
          const cap = speedCap();
          for (const link of linksThrough(w, tiles)) {
            for (const cells of cellsOn(w, link, tileSet)) {
              for (const f of cells) {
                cap[f * VEHICLE_TYPE_COUNT + 5] = clamp(e.bikeVmax, 0, 15);
                const car = f * VEHICLE_TYPE_COUNT;
                cap[car] = clamp(cap[car]! + e.carVmaxDelta, 0, 15);
              }
            }
          }
          break;
        }
        case 'reserveLane': {
          const allowed = typeMask(e.vehicleTypes);
          for (const link of linksThrough(w, tiles)) {
            const lanes = w.links[link]!.lanes;
            if (lanes.length >= 2) {
              t.laneAllowed ??= new Uint8Array(w.lanes.length);
              t.laneAllowed[lanes[0]!] = allowed;
            } else if (lanes.length === 1) {
              // The only lane is reserved: other types lose the road (they route around it).
              for (let vt = 0; vt < VEHICLE_TYPE_COUNT; vt++)
                if (!(allowed & (1 << vt))) mask(vt)[link] = 1;
            }
          }
          break;
        }
        case 'banType': {
          let links: number[];
          if (e.scope === undefined || e.scope === 'target') links = linksThrough(w, tiles);
          else {
            const arterial =
              typeof e.scope === 'object'
                ? e.scope.roadClass === 'arterial'
                : mapLanes(map, tiles[0]!) >= 2;
            links = w.links
              .filter((l) => mapLanes(map, l.tiles[0]!) >= 2 === arterial)
              .map((l) => l.id);
          }
          const m = mask(e.vehicleType);
          for (const l of links) m[l] = 1;
          break;
        }
        case 'scoreModifier':
          for (let vt = 0; vt < VEHICLE_TYPE_COUNT; vt++)
            if (e.vehicleType === undefined || e.vehicleType === vt) t.scoreDelta[vt]! += e.delta;
          break;
        case 'fundsModifier': {
          if (p.target.kind !== 'segment' || e.per === undefined) break; // run controller
          t.tollOf ??= new Int16Array(w.links.length).fill(NONE);
          for (const link of linksThrough(w, tiles)) t.tollOf[link] = tolls.length;
          tolls.push({ delta: e.delta, per: Math.max(1, e.per) });
          break;
        }
        default:
          break;
      }
    }
  }
  if (fasterTicks !== 0) {
    for (let ix = 0; ix < w.intersections.length; ix++)
      setResolveTicks(t, ix, UNCONTROLLED_RESOLVE_TICKS - fasterTicks);
  }
  t.pSlowPermille = pSlow;
  if (tolls.length > 0) t.tollCount = new Int32Array(tolls.length);
  return tolls;
}

/** Funds earned by tolls so far: `delta` per `per` vehicles that entered each toll's links. */
export function tollFunds(t: Traffic, tolls: readonly Toll[]): number {
  let funds = 0;
  for (let k = 0; k < tolls.length; k++)
    funds += idiv(t.tollCount![k]!, tolls[k]!.per) * tolls[k]!.delta;
  return funds;
}
