/**
 * The world (GDD section 3, "World"): tiles, directed links made of lanes, intersections, edges,
 * and routes. Built once per round from the resolved `GridMap` (ADR-001); integer-only.
 *
 * Topology rules (ADR-012):
 * - Two orthogonally adjacent road tiles are connected. A boundary edge connects its tile to the
 *   outside on `edge.side`.
 * - An intersection is a road tile with 3 or 4 road neighbours. Every other road tile has exactly
 *   two connections (road neighbours plus edges), so it is part of one road chain.
 * - Edges sit on road-end tiles, never on an intersection; two intersections are never adjacent.
 * - A link is one direction of travel along a maximal chain of non-intersection road tiles between
 *   two nodes (intersections or edges). Each of its lanes is `CELLS_PER_TILE` cells per tile,
 *   cell 0 upstream. Lane index 0 is the kerb (rightmost, right-hand traffic) lane.
 * - Routes are BFS shortest paths over tiles, ties broken by direction order n, e, s, w.
 */
import { idiv } from './math.js';
import {
  CELLS_PER_TILE,
  GRID_HEIGHT,
  GRID_WIDTH,
  type ControllerKind,
  type GridMap,
  type Side,
} from './types.js';

/** Directions as indices: 0 = n, 1 = e, 2 = s, 3 = w (clockwise). */
export const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;
const TILE_COUNT = GRID_WIDTH * GRID_HEIGHT;
const NONE = -1;

/** Index of a side in `SIDES`. */
export function sideIndex(side: Side): number {
  return side === 'n' ? 0 : side === 'e' ? 1 : side === 's' ? 2 : 3;
}

/** The opposite direction index. */
export function opposite(dir: number): number {
  return (dir + 2) & 3;
}

/** Row-major tile index. */
export function tileIndex(x: number, y: number): number {
  return y * GRID_WIDTH + x;
}

/** Tile classification in `World.tileKind`. */
export const TileKind = { Block: 0, Road: 1, Intersection: 2 } as const;
export type TileKind = (typeof TileKind)[keyof typeof TileKind];

/** A link endpoint: an intersection (by `World.intersections` index) or an edge (by `World.edges` index). */
export interface NodeRef {
  readonly kind: 'intersection' | 'edge';
  readonly index: number;
}

/** One direction of travel along a road chain between two nodes. */
export interface Link {
  readonly id: number;
  readonly from: NodeRef;
  readonly to: NodeRef;
  /** Tile indices in travel order (upstream first). Never empty. */
  readonly tiles: readonly number[];
  /** Direction of travel entering each tile (same length as `tiles`). */
  readonly entryDirs: readonly number[];
  /** Direction of travel leaving each tile (same length as `tiles`). */
  readonly exitDirs: readonly number[];
  /** Cells per lane: `tiles.length * CELLS_PER_TILE`. */
  readonly cells: number;
  /** Lane ids, index 0 = kerb lane. Empty when the direction carries no traffic (one-way). */
  readonly lanes: readonly number[];
  /** The link covering the same tiles in the opposite direction. */
  readonly reverse: number;
}

/** A lane: `cells` cells along its link, cell 0 upstream. Ids fit in a snapshot's Uint16. */
export interface Lane {
  readonly id: number;
  /** The link this lane belongs to, or -1 for an intersection box lane. */
  readonly link: number;
  /** 0 = kerb (rightmost) lane. Box lanes: 0. */
  readonly index: number;
  readonly cells: number;
  /** Box lanes: the intersection index; road lanes: -1. */
  readonly intersection: number;
  /** Box lanes: `Turn` of the movement; road lanes: -1. */
  readonly turn: number;
  /** Box lanes: direction of travel entering and leaving the box; road lanes: -1. */
  readonly entryDir: number;
  readonly exitDir: number;
}

/** Movement through an intersection box. Box lanes are 1 (right), 2 (straight) or 3 (left) cells. */
export const Turn = { Right: 0, Straight: 1, Left: 2 } as const;
export type Turn = (typeof Turn)[keyof typeof Turn];

export interface Intersection {
  readonly index: number;
  readonly tile: number;
  readonly x: number;
  readonly y: number;
  /** Per direction index: the link arriving on that side of the tile, or -1. */
  readonly inLinks: readonly number[];
  /** Per direction index: the link leaving through that side of the tile, or -1. */
  readonly outLinks: readonly number[];
  /** Road neighbours: 3 or 4. */
  readonly approaches: number;
  /** GDD section 3: uncontrolled by default; cards change it (P1-SIM-03/05). */
  controller: ControllerKind;
}

export interface WorldEdge {
  readonly index: number;
  /** The map's edge id, as used by `DemandEvent.edge`. */
  readonly id: number;
  readonly tile: number;
  readonly side: number;
  /** The link vehicles spawned here enter. */
  readonly spawnLink: number;
  /** The link whose downstream end is this edge's sink. */
  readonly sinkLink: number;
}

/** A pre-computed route: the links a vehicle follows from its spawn edge to its sink edge. */
export interface Route {
  readonly origin: number;
  readonly destination: number;
  readonly links: readonly number[];
  /** Tiles travelled, intersections included. */
  readonly tiles: number;
}

export interface World {
  readonly mapId: string;
  /** `TileKind` per tile, row-major. */
  readonly tileKind: Uint8Array;
  /** Intersection index per tile, or -1. */
  readonly tileIntersection: Int16Array;
  readonly links: readonly Link[];
  readonly lanes: readonly Lane[];
  readonly intersections: readonly Intersection[];
  readonly edges: readonly WorldEdge[];
  /** Map edge id to `edges` index. */
  readonly edgeIndexById: ReadonlyMap<number, number>;
  /** Link travelled when leaving a non-intersection road tile in a direction: `[tile * 4 + dir]`, or -1. */
  readonly exitLink: Int16Array;
  /** BFS routes computed on first use, keyed `origin * edges.length + destination`. */
  readonly routeCache: Map<number, Route | null>;
  /** Lanes `[0, roadLanes)` are road lanes; the rest are intersection box lanes. */
  readonly roadLanes: number;
  /** Box lane for a movement: `[intersection * 16 + inSide * 4 + outSide]`, or -1. */
  readonly movementLane: Int32Array;
  /** Flat lane-cell index of each lane's cell 0 (length lanes + 1): `laneCellBase[lane] + cell`. */
  readonly laneCellBase: Int32Array;
  /**
   * Physical cell of each flat lane cell. Road lane cells are their own physical cells; every
   * intersection box has 4 physical quadrant cells (NE, SE, SW, NW) shared by its box lanes, so
   * crossing movements can never occupy the same space.
   */
  readonly cellPhys: Int32Array;
  readonly physCells: number;
  /** Link of each physical cell, or -1 for box quadrants. */
  readonly physLink: Int16Array;
  /** 1 on the flat lane cell where buses stop: the downstream cell of each bus-stop tile. */
  readonly stopCell: Uint8Array;
}

/** Thrown for maps that break the topology rules. Extends RangeError like other input errors. */
export class MapError extends RangeError {
  override name = 'MapError';
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
}

/** True when `side` of tile (x, y) faces the outside of the grid. */
function onBoundary(x: number, y: number, dir: number): boolean {
  return !inBounds(x + DX[dir]!, y + DY[dir]!);
}

/**
 * Builds and validates the world for a map. Pure. Throws `MapError` (a `RangeError`) naming the
 * first broken rule, so content can use it to validate its templates.
 */
export function buildWorld(map: GridMap): World {
  if (map.tiles.length !== TILE_COUNT) {
    throw new MapError(`map "${map.id}" has ${map.tiles.length} tiles, expected ${TILE_COUNT}`);
  }
  const road = new Uint8Array(TILE_COUNT);
  const lanesPerDir = new Uint8Array(TILE_COUNT);
  for (let i = 0; i < TILE_COUNT; i++) {
    const t = map.tiles[i]!;
    if (t.kind === 'road') {
      if (t.lanes !== 1 && t.lanes !== 2) {
        throw new MapError(
          `tile ${at(i)} has ${String(t.lanes)} lanes per direction, expected 1 or 2`,
        );
      }
      road[i] = 1;
      lanesPerDir[i] = t.lanes;
    }
  }

  // Edges: one per (tile, side), on a road tile, facing the boundary, unique ids.
  const edgeAt = new Int16Array(TILE_COUNT * 4).fill(NONE);
  const edgeIndexById = new Map<number, number>();
  if (map.edges.length < 2) throw new MapError(`map "${map.id}" needs at least 2 edges`);
  map.edges.forEach((e, index) => {
    const { x, y } = e.tile;
    if (!Number.isInteger(e.id) || e.id < 0 || e.id > 0xffff) {
      throw new MapError(`edge id ${e.id} must be an integer in [0, 65535]`);
    }
    if (edgeIndexById.has(e.id)) throw new MapError(`duplicate edge id ${e.id}`);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(x, y)) {
      throw new MapError(`edge ${e.id} tile (${x},${y}) is outside the grid`);
    }
    const ti = tileIndex(x, y);
    const dir = sideIndex(e.side);
    if (!road[ti]) throw new MapError(`edge ${e.id} is on block tile ${at(ti)}`);
    if (!onBoundary(x, y, dir)) {
      throw new MapError(`edge ${e.id} side "${e.side}" of ${at(ti)} is not on the map boundary`);
    }
    if (edgeAt[ti * 4 + dir] !== NONE)
      throw new MapError(`two edges on side "${e.side}" of ${at(ti)}`);
    edgeAt[ti * 4 + dir] = index;
    edgeIndexById.set(e.id, index);
  });

  // Classify tiles: intersections have 3-4 road neighbours; other road tiles exactly 2 connections.
  const tileKind = new Uint8Array(TILE_COUNT);
  const tileIntersection = new Int16Array(TILE_COUNT).fill(NONE);
  const neighbourCount = new Uint8Array(TILE_COUNT);
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!road[i]) continue;
    const x = i % GRID_WIDTH;
    const y = idiv(i, GRID_WIDTH);
    let roads = 0;
    let edges = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (inBounds(nx, ny) && road[tileIndex(nx, ny)]) roads++;
      if (edgeAt[i * 4 + d] !== NONE) edges++;
    }
    neighbourCount[i] = roads;
    if (roads >= 3) {
      if (edges > 0) {
        throw new MapError(
          `edge on intersection ${at(i)}; put the edge on a road tile leading to it`,
        );
      }
      tileKind[i] = TileKind.Intersection;
    } else {
      if (roads + edges !== 2) {
        throw new MapError(
          `road tile ${at(i)} has ${roads + edges} connections; a road tile that is not an ` +
            `intersection needs exactly 2 (dead ends need an edge)`,
        );
      }
      tileKind[i] = TileKind.Road;
    }
  }

  // Intersections in row-major order; no two adjacent (a link needs at least one tile of cells).
  const intersections: Intersection[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    if (tileKind[i] !== TileKind.Intersection) continue;
    const x = i % GRID_WIDTH;
    const y = idiv(i, GRID_WIDTH);
    for (let d = 1; d <= 2; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (inBounds(nx, ny) && tileKind[tileIndex(nx, ny)] === TileKind.Intersection) {
        throw new MapError(
          `intersections ${at(i)} and ${at(tileIndex(nx, ny))} are adjacent; leave a road tile between them`,
        );
      }
    }
    tileIntersection[i] = intersections.length;
    intersections.push({
      index: intersections.length,
      tile: i,
      x,
      y,
      inLinks: [NONE, NONE, NONE, NONE],
      outLinks: [NONE, NONE, NONE, NONE],
      approaches: neighbourCount[i]!,
      controller: 'uncontrolled',
    });
  }

  checkConnected(map, road);

  // Trace every directed link from its upstream node: intersections (row-major, sides n e s w),
  // then edges in map order.
  const links: Link[] = [];
  const exitLink = new Int16Array(TILE_COUNT * 4).fill(NONE);
  const spawnLink = new Array<number>(map.edges.length).fill(NONE);
  const sinkLink = new Array<number>(map.edges.length).fill(NONE);
  const trace = (from: NodeRef, startTile: number, heading: number): void => {
    const id = links.length;
    const tiles: number[] = [];
    const entryDirs: number[] = [];
    const exitDirs: number[] = [];
    let tile = startTile;
    let dir = heading;
    const lanes = lanesPerDir[startTile]!;
    for (;;) {
      if (lanesPerDir[tile] !== lanes) {
        throw new MapError(
          `lane count changes between ${at(tiles[tiles.length - 1]!)} and ${at(tile)}; ` +
            `a road between two nodes has one lane count`,
        );
      }
      const x = tile % GRID_WIDTH;
      const y = idiv(tile, GRID_WIDTH);
      // The other connection: not back where we came from.
      let out = NONE;
      for (let d = 0; d < 4; d++) {
        if (d === opposite(dir)) continue;
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (edgeAt[tile * 4 + d] !== NONE || (inBounds(nx, ny) && road[tileIndex(nx, ny)])) {
          out = d;
          break;
        }
      }
      tiles.push(tile);
      entryDirs.push(dir);
      exitDirs.push(out);
      exitLink[tile * 4 + out] = id;
      const edge = edgeAt[tile * 4 + out]!;
      if (edge !== NONE) {
        sinkLink[edge] = id;
        finish({ kind: 'edge', index: edge });
        return;
      }
      const next = tileIndex(x + DX[out]!, y + DY[out]!);
      if (tileKind[next] === TileKind.Intersection) {
        const ix = tileIntersection[next]!;
        (intersections[ix]!.inLinks as number[])[opposite(out)] = id;
        finish({ kind: 'intersection', index: ix });
        return;
      }
      tile = next;
      dir = out;
    }
    function finish(to: NodeRef): void {
      links.push({
        id,
        from,
        to,
        tiles,
        entryDirs,
        exitDirs,
        cells: tiles.length * CELLS_PER_TILE,
        lanes: [],
        reverse: NONE,
      });
    }
  };
  for (const ix of intersections) {
    for (let d = 0; d < 4; d++) {
      const nx = ix.x + DX[d]!;
      const ny = ix.y + DY[d]!;
      if (!inBounds(nx, ny) || !road[tileIndex(nx, ny)]) continue;
      (ix.outLinks as number[])[d] = links.length;
      trace({ kind: 'intersection', index: ix.index }, tileIndex(nx, ny), d);
    }
  }
  map.edges.forEach((e, index) => {
    spawnLink[index] = links.length;
    trace({ kind: 'edge', index }, tileIndex(e.tile.x, e.tile.y), opposite(sideIndex(e.side)));
  });

  // Pair each link with its reverse, then allocate lanes in link order.
  const lanes: Lane[] = [];
  const finalLinks = links.map((l): Link => {
    const first = l.tiles[0]!;
    const reverse = exitLink[first * 4 + opposite(l.entryDirs[0]!)]!;
    const ids: number[] = [];
    for (let k = 0; k < lanesPerDir[first]!; k++) {
      ids.push(lanes.length);
      lanes.push({
        id: lanes.length,
        link: l.id,
        index: k,
        cells: l.cells,
        intersection: NONE,
        turn: NONE,
        entryDir: NONE,
        exitDir: NONE,
      });
    }
    return { ...l, reverse, lanes: ids };
  });
  const roadLanes = lanes.length;

  // Box lanes, one per movement (no U-turns): intersections in order, in-sides then out-sides n e s w.
  const movementLane = new Int32Array(intersections.length * 16).fill(NONE);
  for (const ix of intersections) {
    for (let inSide = 0; inSide < 4; inSide++) {
      if (ix.inLinks[inSide] === NONE) continue;
      const heading = opposite(inSide);
      for (let outSide = 0; outSide < 4; outSide++) {
        if (outSide === inSide || ix.outLinks[outSide] === NONE) continue;
        const turn =
          outSide === heading
            ? Turn.Straight
            : outSide === ((heading + 1) & 3)
              ? Turn.Right
              : Turn.Left;
        movementLane[ix.index * 16 + inSide * 4 + outSide] = lanes.length;
        lanes.push({
          id: lanes.length,
          link: NONE,
          index: 0,
          cells: turn + 1,
          intersection: ix.index,
          turn,
          entryDir: heading,
          exitDir: outSide,
        });
      }
    }
  }

  // Flat lane cells and their physical cells.
  const laneCellBase = new Int32Array(lanes.length + 1);
  for (let i = 0; i < lanes.length; i++) laneCellBase[i + 1] = laneCellBase[i]! + lanes[i]!.cells;
  const flatCells = laneCellBase[lanes.length]!;
  const cellPhys = new Int32Array(flatCells);
  const stopCell = new Uint8Array(flatCells);
  const roadCells = laneCellBase[roadLanes]!;
  const physCells = roadCells + intersections.length * 4;
  const physLink = new Int16Array(physCells).fill(NONE);
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i]!;
    const base = laneCellBase[i]!;
    if (lane.link !== NONE) {
      const link = links[lane.link]!;
      for (let c = 0; c < lane.cells; c++) {
        cellPhys[base + c] = base + c;
        physLink[base + c] = lane.link;
        const tile = map.tiles[link.tiles[idiv(c, CELLS_PER_TILE)]!]!;
        if (
          tile.kind === 'road' &&
          tile.busStop === true &&
          c % CELLS_PER_TILE === CELLS_PER_TILE - 1
        ) {
          stopCell[base + c] = 1;
        }
      }
    } else {
      // Quadrants clockwise from NE = 0. Entering heading h, the vehicle is on the right-hand half:
      // first quadrant (h + 1) & 3, then counter-clockwise toward the far side for straight and left.
      const q0 = (lane.entryDir + 1) & 3;
      for (let c = 0; c < lane.cells; c++) {
        cellPhys[base + c] = roadCells + lane.intersection * 4 + ((q0 + 4 - c) & 3);
      }
    }
  }

  return {
    mapId: map.id,
    tileKind,
    tileIntersection,
    links: finalLinks,
    lanes,
    intersections,
    edges: map.edges.map((e, index) => ({
      index,
      id: e.id,
      tile: tileIndex(e.tile.x, e.tile.y),
      side: sideIndex(e.side),
      spawnLink: spawnLink[index]!,
      sinkLink: sinkLink[index]!,
    })),
    edgeIndexById,
    exitLink,
    routeCache: new Map(),
    roadLanes,
    movementLane,
    laneCellBase,
    cellPhys,
    physCells,
    physLink,
    stopCell,
  };
}

/** "(x,y)" for error messages. */
function at(tile: number): string {
  return `(${tile % GRID_WIDTH},${idiv(tile, GRID_WIDTH)})`;
}

/** All road tiles form one connected component. */
function checkConnected(map: GridMap, road: Uint8Array): void {
  let first = NONE;
  let total = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if (road[i]) {
      total++;
      if (first === NONE) first = i;
    }
  }
  const seen = new Uint8Array(TILE_COUNT);
  const queue = new Int16Array(TILE_COUNT);
  let head = 0;
  let tail = 0;
  queue[tail++] = first;
  seen[first] = 1;
  while (head < tail) {
    const t = queue[head++]!;
    const x = t % GRID_WIDTH;
    const y = idiv(t, GRID_WIDTH);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (!inBounds(nx, ny)) continue;
      const n = tileIndex(nx, ny);
      if (road[n] && !seen[n]) {
        seen[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  if (tail !== total) {
    throw new MapError(
      `map "${map.id}" roads are not connected (${total - tail} tiles unreachable)`,
    );
  }
}

/** The link a vehicle uses when leaving `tile` in direction `dir`, or -1. */
function stepLink(world: World, tile: number, dir: number): number {
  const ix = world.tileIntersection[tile]!;
  if (ix !== NONE) return world.intersections[ix]!.outLinks[dir]!;
  return world.exitLink[tile * 4 + dir]!;
}

/**
 * The BFS shortest route (in tiles) from edge index `origin` to edge index `destination`, or null
 * when one-way roads make it unreachable. Ties go to the first direction in n, e, s, w order.
 * Cached per world, since the network is fixed for the round.
 */
export function route(world: World, origin: number, destination: number): Route | null {
  if (!world.edges[origin] || !world.edges[destination]) {
    throw new RangeError(`edge index out of range: ${origin} -> ${destination}`);
  }
  const key = origin * world.edges.length + destination;
  const cached = world.routeCache.get(key);
  if (cached !== undefined) return cached;
  const r = bfsRoute(world, origin, destination);
  world.routeCache.set(key, r);
  return r;
}

/** The route between two map edge ids (as used in `DemandEvent`). Throws on unknown ids. */
export function routeByEdgeId(world: World, originId: number, destinationId: number): Route | null {
  return route(world, edgeIndex(world, originId), edgeIndex(world, destinationId));
}

/** `World.edges` index for a map edge id. Throws `RangeError` for unknown ids. */
export function edgeIndex(world: World, id: number): number {
  const i = world.edgeIndexById.get(id);
  if (i === undefined) throw new RangeError(`unknown edge id ${id} on map "${world.mapId}"`);
  return i;
}

const bfsParent = new Int16Array(TILE_COUNT);
const bfsParentDir = new Int8Array(TILE_COUNT);
const bfsQueue = new Int16Array(TILE_COUNT);

function bfsRoute(world: World, origin: number, destination: number): Route | null {
  // Indices were checked by `route`.
  const o = world.edges[origin]!;
  const d = world.edges[destination]!;
  if (origin === destination) throw new RangeError(`route from edge ${o.id} to itself`);
  if (world.links[o.spawnLink]!.lanes.length === 0) return null;

  // Scratch buffers are module-level: the sim is single-threaded and BFS never re-enters.
  const parent = bfsParent.fill(NONE);
  const parentDir = bfsParentDir;
  const queue = bfsQueue;
  let head = 0;
  let tail = 0;
  queue[tail++] = o.tile;
  parent[o.tile] = o.tile;
  let found = false;
  while (head < tail) {
    const t = queue[head++]!;
    if (t === d.tile && stepUsable(world, t, d.side)) {
      found = true;
      break;
    }
    const x = t % GRID_WIDTH;
    const y = idiv(t, GRID_WIDTH);
    for (let dir = 0; dir < 4; dir++) {
      const nx = x + DX[dir]!;
      const ny = y + DY[dir]!;
      if (!inBounds(nx, ny)) continue;
      const n = tileIndex(nx, ny);
      if (world.tileKind[n] === TileKind.Block || parent[n] !== NONE) continue;
      if (!stepUsable(world, t, dir)) continue;
      parent[n] = t;
      parentDir[n] = dir;
      queue[tail++] = n;
    }
  }
  if (!found) return null;

  // Walk back to collect exit directions, then map each tile's exit to its link.
  const path: number[] = [];
  const exits: number[] = [];
  let exit = d.side;
  for (let t = d.tile; ; t = parent[t]!) {
    path.push(t);
    exits.push(exit);
    if (t === o.tile) break;
    exit = parentDir[t]!;
  }
  const links: number[] = [];
  for (let k = path.length - 1; k >= 0; k--) {
    const l = stepLink(world, path[k]!, exits[k]!);
    if (links[links.length - 1] !== l) links.push(l);
  }
  return { origin, destination, links, tiles: path.length };
}

/** True when leaving `tile` in `dir` is on a link that carries traffic. */
function stepUsable(world: World, tile: number, dir: number): boolean {
  const l = stepLink(world, tile, dir);
  return l !== NONE && world.links[l]!.lanes.length > 0;
}

/**
 * Time-weighted route for taxis (GDD section 3: "taxis recompute on entry using time-weighted
 * costs"): the cheapest link sequence from intersection `from`, entered on side `arrivalSide`
 * (no U-turn back out of it; -1 allows any exit), to edge index `destination`. `cost(link)` must
 * return a positive integer, e.g. expected ticks to traverse. Ties go to the lower link id.
 * Returns null when unreachable.
 */
export function weightedRoute(
  world: World,
  from: number,
  arrivalSide: number,
  destination: number,
  cost: (link: number) => number,
): number[] | null {
  const n = world.links.length;
  if (dist.length < n) {
    dist = new Int32Array(n * 2);
    prev = new Int32Array(n * 2);
    done = new Uint8Array(n * 2);
  }
  dist.fill(-1, 0, n);
  prev.fill(NONE, 0, n);
  done.fill(0, 0, n);
  heapLen = 0;
  const relax = (link: number, base: number, p: number): void => {
    if (world.links[link]!.lanes.length === 0) return;
    const c = cost(link);
    if (!Number.isInteger(c) || c < 1)
      throw new RangeError(`link cost must be a positive integer, got ${c}`);
    const nd = base + c;
    if (dist[link] === -1 || nd < dist[link]!) {
      dist[link] = nd;
      prev[link] = p;
      heapPush(nd * HEAP_LINKS + link);
    }
  };
  const start = world.intersections[from];
  if (!start) throw new RangeError(`intersection index out of range: ${from}`);
  for (let dir = 0; dir < 4; dir++) {
    const l = start.outLinks[dir]!;
    if (l !== NONE && dir !== arrivalSide) relax(l, 0, NONE);
  }
  while (heapLen > 0) {
    // Keys are dist * HEAP_LINKS + link, so the minimum is the lowest distance, then link id.
    const key = heapPop();
    const best = key % HEAP_LINKS;
    if (done[best] || idiv(key, HEAP_LINKS) !== dist[best]) continue; // stale entry
    done[best] = 1;
    const link = world.links[best]!;
    if (link.to.kind === 'edge') {
      if (link.to.index !== destination) continue;
      const out: number[] = [];
      for (let l = best; l !== NONE; l = prev[l]!) out.push(l);
      return out.reverse();
    }
    const ix = world.intersections[link.to.index]!;
    const arrived = opposite(link.exitDirs[link.exitDirs.length - 1]!);
    for (let dir = 0; dir < 4; dir++) {
      const l = ix.outLinks[dir]!;
      if (l !== NONE && dir !== arrived && !done[l]) relax(l, dist[best]!, best);
    }
  }
  return null;
}

/** Heap key stride: link ids stay below this (a 7×9 map has well under 256 links). */
const HEAP_LINKS = 4096;
let dist = new Int32Array(256);
let prev = new Int32Array(256);
let done = new Uint8Array(256);
let heap = new Int32Array(256);
let heapLen = 0;

function heapPush(key: number): void {
  if (heapLen === heap.length) {
    const grown = new Int32Array(heap.length * 2);
    grown.set(heap);
    heap = grown;
  }
  let i = heapLen++;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent]! <= key) break;
    heap[i] = heap[parent]!;
    i = parent;
  }
  heap[i] = key;
}

function heapPop(): number {
  const top = heap[0]!;
  const last = heap[--heapLen]!;
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= heapLen) break;
    if (c + 1 < heapLen && heap[c + 1]! < heap[c]!) c++;
    if (heap[c]! >= last) break;
    heap[i] = heap[c]!;
    i = c;
  }
  heap[i] = last;
  return top;
}

/**
 * Where a lane cell is, for the renderer: its tile, the cell's offset within the tile
 * (0 = upstream), and the travel directions there. For an intersection box lane, `offset` is the
 * step along the turn path and `quadrant` the box quarter the vehicle is in (0 NE, 1 SE, 2 SW,
 * 3 NW): right turns use 1 quarter, straight 2, left 3, starting in the right-hand quarter of the
 * approach. Road cells have `quadrant` -1.
 */
export function locateCell(
  world: World,
  laneId: number,
  cell: number,
): { tile: number; offset: number; entryDir: number; exitDir: number; quadrant: number } {
  const lane = world.lanes[laneId];
  if (!lane || !Number.isInteger(cell) || cell < 0 || cell >= lane.cells) {
    throw new RangeError(`no cell ${cell} on lane ${laneId}`);
  }
  if (lane.link === NONE) {
    return {
      tile: world.intersections[lane.intersection]!.tile,
      offset: cell,
      entryDir: lane.entryDir,
      exitDir: lane.exitDir,
      quadrant: (lane.entryDir + 5 - cell) & 3,
    };
  }
  const link = world.links[lane.link]!;
  const k = idiv(cell, CELLS_PER_TILE);
  return {
    tile: link.tiles[k]!,
    offset: cell - k * CELLS_PER_TILE,
    entryDir: link.entryDirs[k]!,
    exitDir: link.exitDirs[k]!,
    quadrant: NONE,
  };
}
