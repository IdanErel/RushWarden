import {
  GRID_HEIGHT,
  GRID_WIDTH,
  ROUND_TICKS,
  type Effect,
  type GridMap,
  type MapTile,
  type Placement,
  type Target,
  type TileRef,
} from './types.js';

/**
 * Placement validation (Effect union v2, ADR-014). The sim applies effects in P1-SIM-05; these
 * checks run in `Sim.init` now so invalid card data or targets fail loudly, and the UI can call
 * `placementError` to grey out targets a card cannot be placed on.
 */

function tileInBounds(t: TileRef): boolean {
  return (
    Number.isInteger(t.x) &&
    Number.isInteger(t.y) &&
    t.x >= 0 &&
    t.x < GRID_WIDTH &&
    t.y >= 0 &&
    t.y < GRID_HEIGHT
  );
}

/**
 * The tiles of a segment target, from `from` to `to` inclusive. Segments are straight (same row
 * or column); returns null otherwise, when out of bounds, or (given `map`) when any tile is not a
 * road tile.
 */
export function segmentTiles(
  target: Extract<Target, { kind: 'segment' }>,
  map?: GridMap,
): TileRef[] | null {
  const { from, to } = target;
  if (!tileInBounds(from) || !tileInBounds(to)) return null;
  if (from.x !== to.x && from.y !== to.y) return null;
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const out: TileRef[] = [];
  for (let x = from.x, y = from.y; ; x += dx, y += dy) {
    if (map && map.tiles[y * GRID_WIDTH + x]?.kind !== 'road') return null;
    out.push({ x, y });
    if (x === to.x && y === to.y) return out;
  }
}

function targetError(map: GridMap, t: Target): string | null {
  switch (t.kind) {
    case 'district':
      return null;
    case 'edge':
      return map.edges.some((e) => e.id === t.edge) ? null : `unknown edge ${t.edge}`;
    case 'intersection':
      return tileInBounds(t.tile) ? null : `intersection tile out of bounds`;
    case 'segment':
      return segmentTiles(t, map) ? null : `segment must be a straight in-bounds run of road tiles`;
  }
}

function inRange(n: number, lo: number, hi: number): boolean {
  return Number.isInteger(n) && n >= lo && n <= hi;
}

function effectError(map: GridMap, p: Placement, e: Effect): string | null {
  switch (e.kind) {
    case 'setBusStopDwell': {
      if (p.target.kind !== 'segment') return 'setBusStopDwell needs a segment target';
      // The target was validated first, so this is a straight run of road tiles.
      const tiles = segmentTiles(p.target, map)!;
      const hasStop = tiles.some((t) => {
        const tile = map.tiles[t.y * GRID_WIDTH + t.x] as Extract<MapTile, { kind: 'road' }>;
        return tile.busStop === true;
      });
      if (!hasStop) return 'setBusStopDwell is valid only on a segment that already has a bus stop';
      return inRange(e.dwellTicks, 0, ROUND_TICKS) ? null : 'dwellTicks out of range';
    }
    case 'setOneWay':
      if (e.direction !== undefined) return null;
      if (p.target.kind !== 'segment') return 'setOneWay without direction needs a segment target';
      return p.target.from.x === p.target.to.x && p.target.from.y === p.target.to.y
        ? 'setOneWay without direction needs a segment with from != to'
        : null;
    case 'reroute':
      if (!inRange(e.percent, 0, 100)) return 'reroute percent must be 0..100';
      if (e.to === 'secondary' && p.secondaryTarget?.kind !== 'edge') {
        return 'reroute to secondary needs an edge secondaryTarget';
      }
      return null;
    case 'banType':
      return e.scope === 'target-class' && p.target.kind !== 'segment'
        ? 'banType scope target-class needs a segment target'
        : null;
    case 'costModifier': {
      const relative = e.delta !== undefined;
      const absolute = e.next !== undefined || e.cost !== undefined;
      if (relative === absolute)
        return 'costModifier needs either delta, or next + cost (not both)';
      if (absolute) {
        if (e.next !== 1 && e.next !== 2) return 'costModifier next must be 1 or 2';
        if (e.cost === undefined || !inRange(e.cost, 0, 3)) return 'costModifier cost must be 0..3';
      } else if (!Number.isInteger(e.delta)) return 'costModifier delta must be an integer';
      return null;
    }
    case 'smoothDemand':
      return inRange(e.peakPermille, 0, 1000) ? null : 'peakPermille must be 0..1000';
    case 'spawnWindow':
      return inRange(e.fromTick, 0, ROUND_TICKS) &&
        inRange(e.toTick, 0, ROUND_TICKS) &&
        e.fromTick < e.toTick
        ? null
        : `spawnWindow needs 0 <= fromTick < toTick <= ${ROUND_TICKS}`;
    case 'setSpeedLimit':
      if (e.max !== undefined && !inRange(e.max, 0, 15)) return 'setSpeedLimit max must be 0..15';
      if (e.cells !== undefined && !inRange(e.cells, 1, 0xffff))
        return 'setSpeedLimit cells must be >= 1';
      return null;
    default:
      return null;
  }
}

/** Why `p` cannot be placed on `map`, or null when it is valid. */
export function placementError(map: GridMap, p: Placement): string | null {
  const err =
    targetError(map, p.target) ?? (p.secondaryTarget ? targetError(map, p.secondaryTarget) : null);
  if (err) return err;
  for (const e of p.effects) {
    const ee = effectError(map, p, e);
    if (ee) return ee;
  }
  return null;
}

/** Throws `RangeError` for the first invalid placement this round or carried in `runEffects`. */
export function validatePlacements(map: GridMap, placements: readonly Placement[]): void {
  for (const p of placements) {
    const err = placementError(map, p);
    if (err) throw new RangeError(`placement "${p.cardId}" (order ${p.order}): ${err}`);
  }
}
