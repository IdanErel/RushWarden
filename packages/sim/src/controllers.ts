/**
 * Intersection controllers (GDD section 3, tick rule 5; P1-SIM-03). They decide which vehicle may
 * cross an intersection's stop line into its box this tick. Physical conflicts inside the box are
 * already impossible (box quarters are shared cells, ADR-017); controllers add the right-of-way:
 *
 * - `uncontrolled`: "first at line, then rightmost". A vehicle at the stop line for at least
 *   `resolveTicks` ticks may be granted; one grant per intersection per tick, to the earliest
 *   arrival, ties to the approach with nobody on its right (yield to the right).
 * - `signal`: "by phase". Two phases (n-s, e-w); fixed time (`SIGNAL_GREEN_TICKS` green) or
 *   adaptive ("longest queue gets green"), with `switchTicks` of all-red between greens.
 * - `roundabout`: "inside has priority, max occupancy 4". Entry needs the box to hold fewer than
 *   `capacity` vehicles and the quarter circulating traffic would come from to be free.
 * - `stop-all`: like uncontrolled, but the vehicle must have stopped at the line and the box must
 *   be empty: one vehicle at a time.
 * - `priority(dir)`: approaches on the axis of `dir` enter freely; the minor road is granted like
 *   uncontrolled only when no major-road vehicle is within one tile of the line.
 *
 * Vehicle behaviours from the section 3 table: emergency vehicles ignore signals and win every
 * grant without waiting ("others yield; ignores signals"); a truck on a turning movement blocks its
 * whole intersection to new entries ("blocks a full intersection cell while turning").
 * A turn pocket (Turn Lane) lets turning vehicles wait off the through lane, so they no longer
 * block it.
 */
import {
  CELLS_PER_TILE,
  DEFAULT_SWITCH_TICKS,
  VehicleType,
  type ControllerKind,
  type Side,
} from './types.js';
import type { Traffic } from './traffic.js';
import { sideIndex, Turn } from './world.js';

/** Controller codes in `Traffic.ctrlKind` and `controllerFrame`. Stable; never renumber. */
export const ControllerCode = {
  Uncontrolled: 0,
  Signal: 1,
  Roundabout: 2,
  StopAll: 3,
  Priority: 4,
} as const;

const CODES: Record<ControllerKind, number> = {
  uncontrolled: ControllerCode.Uncontrolled,
  signal: ControllerCode.Signal,
  roundabout: ControllerCode.Roundabout,
  'stop-all': ControllerCode.StopAll,
  priority: ControllerCode.Priority,
};

/** Fixed-time green per phase, in ticks (2 s). */
export const SIGNAL_GREEN_TICKS = 40;
/** Adaptive signals hold green at least this long before switching to a longer queue. */
export const ADAPTIVE_MIN_GREEN_TICKS = 10;
/** Adaptive signals switch after this long if the other phase has anyone waiting. */
export const ADAPTIVE_MAX_GREEN_TICKS = 80;
/** Ticks from arriving at an uncontrolled stop line to entering the box (Yield Culture lowers it). */
export const UNCONTROLLED_RESOLVE_TICKS = 3;
/** Roundabout max occupancy (GDD section 3; the Roundabout card's upgrade raises it to 6). */
export const ROUNDABOUT_CAPACITY = 4;

/** Turn pocket modes per approach (`Traffic.pocketMode`). */
export const PocketMode = { None: 0, Left: 1, Both: 2 } as const;

const NONE = -1;

/** Sets an intersection's controller for the round; signal timers restart at phase 0 (n-s). */
export function setController(
  t: Traffic,
  ix: number,
  kind: ControllerKind,
  opts: { direction?: Side; capacity?: number } = {},
): void {
  t.ctrlKind[ix] = CODES[kind];
  t.ctrlCapacity[ix] = opts.capacity ?? ROUNDABOUT_CAPACITY;
  t.ctrlAxis[ix] = opts.direction === undefined ? 0 : sideIndex(opts.direction) & 1;
  t.sigPhase[ix] = 0;
  t.sigTimer[ix] = 0;
  t.sigClearing[ix] = 0;
}

/** Signal timing: adaptive or fixed, and the all-red switch time (default `DEFAULT_SWITCH_TICKS`). */
export function configureSignal(
  t: Traffic,
  ix: number,
  adaptive: boolean,
  switchTicks = DEFAULT_SWITCH_TICKS,
): void {
  t.sigAdaptive[ix] = adaptive ? 1 : 0;
  t.sigSwitchTicks[ix] = switchTicks < 0 ? 0 : switchTicks;
}

/** Ticks an uncontrolled stop line takes to resolve (minimum 1: the vehicle reaches the line first). */
export function setResolveTicks(t: Traffic, ix: number, ticks: number): void {
  t.resolveTicks[ix] = ticks < 1 ? 1 : ticks;
}

/** Turn pockets on every approach of an intersection. */
export function setTurnPockets(t: Traffic, ix: number, mode: number): void {
  for (let s = 0; s < 4; s++) t.pocketMode[ix * 4 + s] = mode;
}

/** True when the approach on `inSide` has green (signals only). */
function green(t: Traffic, ix: number, inSide: number): boolean {
  return t.sigClearing[ix] === 0 && (inSide & 1) === t.sigPhase[ix];
}

/** Occupied cells on the approaches of a signal phase: the "queue" adaptive signals compare. */
function phaseLoad(t: Traffic, ix: number, phase: number): number {
  const inLinks = t.world.intersections[ix]!.inLinks;
  let load = 0;
  for (let s = phase; s < 4; s += 2) {
    const l = inLinks[s]!;
    if (l !== NONE) load += t.linkLoad[l]!;
  }
  return load;
}

function advanceSignal(t: Traffic, ix: number): void {
  if (t.sigClearing[ix]! > 0) {
    t.sigClearing[ix]!--;
    if (t.sigClearing[ix] === 0) {
      t.sigPhase[ix] = t.sigPhase[ix]! ^ 1;
      t.sigTimer[ix] = 0;
    }
    return;
  }
  const timer = ++t.sigTimer[ix]!;
  let change: boolean;
  if (t.sigAdaptive[ix]) {
    const mine = phaseLoad(t, ix, t.sigPhase[ix]!);
    const other = phaseLoad(t, ix, t.sigPhase[ix]! ^ 1);
    change =
      (timer > ADAPTIVE_MIN_GREEN_TICKS && other > mine) ||
      (timer > ADAPTIVE_MAX_GREEN_TICKS && other > 0);
  } else {
    change = timer > SIGNAL_GREEN_TICKS;
  }
  if (!change) return;
  if (t.sigSwitchTicks[ix] === 0) {
    t.sigPhase[ix] = t.sigPhase[ix]! ^ 1;
    t.sigTimer[ix] = 0;
  } else {
    t.sigClearing[ix] = t.sigSwitchTicks[ix]!;
  }
}

/** True when any major-road approach has a vehicle within one tile of the line (priority). */
function majorTrafficNear(t: Traffic, ix: number): boolean {
  const w = t.world;
  const node = w.intersections[ix]!;
  for (let s = t.ctrlAxis[ix]!; s < 4; s += 2) {
    const l = node.inLinks[s]!;
    if (l === NONE) continue;
    for (const lane of w.links[l]!.lanes) {
      const end = w.laneCellBase[lane]! + t.laneCells[lane]!;
      for (let f = end - CELLS_PER_TILE; f < end; f++) if (t.occ[w.cellPhys[f]!] !== 0) return true;
    }
    const pocket = w.pocketLane[ix * 4 + s]!;
    if (t.occ[w.cellPhys[w.laneCellBase[pocket]!]!] !== 0) return true;
  }
  return false;
}

/**
 * Emergency vehicles everywhere, and `preferType` types (Bus Priority) at their intersection:
 * they enter on red and win grants without the resolve wait (ADR-023).
 */
function priorityVehicle(t: Traffic, i: number, ix: number): boolean {
  const vt = t.type[i]!;
  return (
    vt === VehicleType.Emergency || (t.preferMask !== null && (t.preferMask[ix]! & (1 << vt)) !== 0)
  );
}

// Grant candidates (module scratch).
const candVehicle = new Int32Array(16);
const candSide = new Int8Array(16);

/** Picks this tick's grant for an uncontrolled, stop-all or priority intersection. */
function grant(t: Traffic, ix: number): number {
  if (t.lineOcc[ix] === 0) return NONE; // nobody at any stop line
  const kind = t.ctrlKind[ix]!;
  const tick = t.tick;
  if (kind === ControllerCode.StopAll && t.boxCount[ix]! > 0) return NONE;
  let majorNear = -1; // computed on first need: -1 unknown, 0 no, 1 yes
  let n = 0;
  let emergency = false;
  const { occ, linePhys, lineLane, lineSide, lane: vLane, cell: vCell, laneCells, atLine } = t;
  // Every stop-line cell of this intersection (approach lanes and pockets), precomputed.
  for (let e = t.lineStart[ix]!, end = t.lineStart[ix + 1]!; e < end; e++) {
    const j = occ[linePhys[e]!]! - 1;
    if (j < 0) continue;
    const lane = lineLane[e]!;
    if (vLane[j] !== lane || vCell[j] !== laneCells[lane]! - 1) continue; // a tail, not a head
    const s = lineSide[e]!;
    if (kind === ControllerCode.Priority && (s & 1) === t.ctrlAxis[ix]) continue; // major road
    const isEmergency = priorityVehicle(t, j, ix);
    if (!isEmergency) {
      if (emergency) continue;
      if (kind === ControllerCode.Uncontrolled && tick - atLine[j]! < t.resolveTicks[ix]!) continue;
      if (kind === ControllerCode.StopAll && (t.speed[j] !== 0 || atLine[j]! >= tick)) continue;
      if (kind === ControllerCode.Priority) {
        if (majorNear < 0) majorNear = majorTrafficNear(t, ix) ? 1 : 0;
        if (majorNear === 1) continue;
      }
    } else if (!emergency) {
      emergency = true;
      n = 0; // emergency vehicles win over everyone else
    }
    candVehicle[n] = j;
    candSide[n] = s;
    n++;
  }
  if (n === 0) return NONE;
  // First at line (earliest arrival).
  let first = 0x7fffffff;
  for (let c = 0; c < n; c++) first = Math.min(first, t.atLine[candVehicle[c]!]!);
  let mask = 0;
  for (let c = 0; c < n; c++) if (t.atLine[candVehicle[c]!] === first) mask |= 1 << candSide[c]!;
  // Then rightmost: the approach with nobody on its right ((s + 3) & 3 is to the right of s).
  let side = NONE;
  for (let s = 0; s < 4; s++) {
    if (mask & (1 << s) && !(mask & (1 << ((s + 3) & 3)))) {
      side = s;
      break;
    }
  }
  if (side === NONE) side = 31 - Math.clz32(mask & -mask); // all four at once: lowest side
  let best = NONE;
  for (let c = 0; c < n; c++) {
    const j = candVehicle[c]!;
    if (candSide[c] === side && t.atLine[j] === first && (best === NONE || j < best)) best = j;
  }
  return best;
}

/** Rule 5, start of tick: advances signals and picks grants. */
export function updateControllers(t: Traffic): void {
  const count = t.world.intersections.length;
  for (let ix = 0; ix < count; ix++) {
    const kind = t.ctrlKind[ix]!;
    t.granted[ix] = NONE;
    if (kind === ControllerCode.Signal) advanceSignal(t, ix);
    else if (kind !== ControllerCode.Roundabout) t.granted[ix] = grant(t, ix);
  }
}

/** Rule 5 at the stop line: may vehicle `i` enter box lane `box` of intersection `ix` from `inSide`? */
export function mayEnter(t: Traffic, i: number, ix: number, inSide: number, box: number): boolean {
  if (t.truckTurning[ix]! > 0) return false;
  const kind = t.ctrlKind[ix]!;
  if (kind === ControllerCode.Signal) return green(t, ix, inSide) || priorityVehicle(t, i, ix);
  if (kind === ControllerCode.Roundabout) {
    if (t.boxCount[ix]! >= t.ctrlCapacity[ix]!) return false;
    // Inside has priority: the quarter circulating traffic enters our entry quarter from must be free.
    const w = t.world;
    const entryQuarter = w.cellPhys[w.laneCellBase[box]!]! - t.boxBase - ix * 4;
    return t.occ[t.boxBase + ix * 4 + ((entryQuarter + 1) & 3)] === 0;
  }
  if (kind === ControllerCode.Priority && (inSide & 1) === t.ctrlAxis[ix]) return true;
  return t.granted[ix] === i;
}

/** Book-keeping when vehicle `i`'s head enters box lane `box`. */
export function enterBox(t: Traffic, i: number, box: number): void {
  const ix = t.laneIx[box]!;
  t.boxCount[ix]!++;
  if (t.entryLog) t.entryLog.push(i, ix, t.tick);
  if (t.type[i] === VehicleType.Truck && t.laneTurn[box] !== Turn.Straight) t.truckTurning[ix]!++;
}

/** Book-keeping when vehicle `i`'s head leaves box lane `box`. */
export function leaveBox(t: Traffic, i: number, box: number): void {
  const ix = t.laneIx[box]!;
  t.boxCount[ix]!--;
  if (t.type[i] === VehicleType.Truck && t.laneTurn[box] !== Turn.Straight) t.truckTurning[ix]!--;
}

/**
 * Per-intersection controller state for the renderer: `[kind, greenMask, boxCount]` per
 * intersection, in intersection order. `greenMask` has bit `side` set for each approach that may
 * enter now (signals: green sides; 0 during all-red; other kinds: 0).
 */
export function controllerFrame(t: Traffic): Uint8Array {
  const n = t.world.intersections.length;
  const out = new Uint8Array(n * 3);
  for (let ix = 0; ix < n; ix++) {
    const kind = t.ctrlKind[ix]!;
    let mask = 0;
    if (kind === ControllerCode.Signal && t.sigClearing[ix] === 0) {
      mask = t.sigPhase[ix] === 0 ? 0b0101 : 0b1010;
    }
    out[ix * 3] = kind;
    out[ix * 3 + 1] = mask;
    out[ix * 3 + 2] = t.boxCount[ix]!;
  }
  return out;
}
