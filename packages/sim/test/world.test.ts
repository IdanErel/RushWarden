import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CELLS_PER_TILE,
  GRID_HEIGHT,
  GRID_WIDTH,
  MapError,
  Sim,
  TileKind,
  buildWorld,
  edgeIndex,
  emptyMap,
  locateCell,
  opposite,
  route,
  routeByEdgeId,
  sampleInput,
  sideIndex,
  tileIndex,
  weightedRoute,
  type GridMap,
  type MapEdge,
  type MapTile,
  type World,
} from '../src/index.js';

/**
 * Builds a map from 9 rows of 7 characters: '.' block, '1' or '2' road with that many lanes per
 * direction.
 */
function parse(id: string, rows: string[], edges: MapEdge[]): GridMap {
  expect(rows).toHaveLength(GRID_HEIGHT);
  const tiles: MapTile[] = [];
  for (const row of rows) {
    expect(row).toHaveLength(GRID_WIDTH);
    for (const c of row)
      tiles.push(c === '.' ? { kind: 'block' } : { kind: 'road', lanes: c === '2' ? 2 : 1 });
  }
  return { id, tiles, edges };
}

/** A rectangle loop with a stub north (edge 10) and a stub south (edge 20). */
const loopMap = parse(
  'loop',
  [
    '...1...',
    '.11111.',
    '.1...1.',
    '.1...1.',
    '.1...1.',
    '.11111.',
    '...1...',
    '...1...',
    '...1...',
  ],
  [
    { id: 10, tile: { x: 3, y: 0 }, side: 'n' },
    { id: 20, tile: { x: 3, y: 8 }, side: 's' },
  ],
);

/** Removes a link's lanes, as a one-way card will (P1-SIM-05), and drops cached routes. */
function closeLink(w: World, id: number): void {
  (w.links[id] as unknown as { lanes: number[] }).lanes = [];
  w.routeCache.clear();
}

/** Every lane, link and route invariant that must hold on any valid world. */
function checkInvariants(w: World): void {
  const seenExit = new Set<number>();
  for (const l of w.links) {
    expect(l.tiles.length).toBeGreaterThan(0);
    expect(l.cells).toBe(l.tiles.length * CELLS_PER_TILE);
    expect(w.links[l.reverse]!.reverse).toBe(l.id);
    expect([...w.links[l.reverse]!.tiles].reverse()).toEqual(l.tiles);
    for (let k = 0; k < l.tiles.length; k++) {
      const key = l.tiles[k]! * 4 + l.exitDirs[k]!;
      expect(seenExit.has(key)).toBe(false);
      seenExit.add(key);
      expect(w.exitLink[key]).toBe(l.id);
      expect(w.tileKind[l.tiles[k]!]).toBe(TileKind.Road);
      if (k > 0) expect(l.entryDirs[k]).toBe(l.exitDirs[k - 1]);
    }
    expect(l.lanes.length === 1 || l.lanes.length === 2).toBe(true);
    l.lanes.forEach((id, i) => {
      expect(w.lanes[id]).toEqual({ id, link: l.id, index: i, cells: l.cells });
    });
  }
  w.lanes.forEach((lane, i) => expect(lane.id).toBe(i));
  for (const ix of w.intersections) {
    expect(ix.approaches === 3 || ix.approaches === 4).toBe(true);
    expect(ix.inLinks.filter((l) => l >= 0)).toHaveLength(ix.approaches);
    expect(ix.outLinks.filter((l) => l >= 0)).toHaveLength(ix.approaches);
    for (let d = 0; d < 4; d++) {
      const out = ix.outLinks[d]!;
      if (out < 0) continue;
      expect(w.links[out]!.from).toEqual({ kind: 'intersection', index: ix.index });
      expect(w.links[out]!.entryDirs[0]).toBe(d);
      expect(ix.inLinks[d]).toBe(w.links[out]!.reverse);
    }
  }
  for (const e of w.edges) {
    expect(w.links[e.spawnLink]!.from).toEqual({ kind: 'edge', index: e.index });
    expect(w.links[e.sinkLink]!.to).toEqual({ kind: 'edge', index: e.index });
    expect(w.links[e.spawnLink]!.reverse).toBe(e.sinkLink);
  }
  // Every edge pair is routable; routes are contiguous and as long as their links plus crossings.
  for (const o of w.edges) {
    for (const d of w.edges) {
      if (o === d) continue;
      const r = route(w, o.index, d.index)!;
      expect(r).not.toBeNull();
      expect(r.links[0]).toBe(o.spawnLink);
      expect(r.links[r.links.length - 1]).toBe(d.sinkLink);
      let tiles = 0;
      for (let k = 0; k < r.links.length; k++) {
        const l = w.links[r.links[k]!]!;
        tiles += l.tiles.length;
        if (k > 0) {
          const prev = w.links[r.links[k - 1]!]!;
          expect(prev.to.kind).toBe('intersection');
          expect(l.from).toEqual(prev.to);
          tiles += 1;
          expect(l.id).not.toBe(prev.reverse); // no U-turns
        }
      }
      expect(r.tiles).toBe(tiles);
      // BFS is shortest: equal in length to Dijkstra with unit tile costs.
      if (r.links.length > 1) {
        const first = w.links[r.links[0]!]!;
        const ix = first.to.index;
        const arrival = opposite(first.exitDirs[first.exitDirs.length - 1]!);
        const unit = (l: number): number => w.links[l]!.tiles.length + 1;
        const wr = weightedRoute(w, ix, arrival, d.index, unit)!;
        const cost = wr.reduce((s, l) => s + unit(l), 0);
        // `unit` counts the sink link's +1 crossing that does not exist; subtract it.
        expect(first.tiles.length + 1 + cost - 1).toBe(r.tiles);
      }
    }
  }
}

describe('buildWorld on the plus map', () => {
  const w = buildWorld(emptyMap());

  it('finds the single 4-way intersection and the four edges', () => {
    expect(w.intersections).toHaveLength(1);
    const ix = w.intersections[0]!;
    expect([ix.x, ix.y, ix.approaches, ix.controller]).toEqual([3, 4, 4, 'uncontrolled']);
    expect(w.tileIntersection[tileIndex(3, 4)]).toBe(0);
    expect(w.tileKind[tileIndex(0, 0)]).toBe(TileKind.Block);
    expect(w.tileKind[tileIndex(3, 0)]).toBe(TileKind.Road);
    expect(w.edges.map((e) => e.id)).toEqual([0, 1, 2, 3]);
  });

  it('makes one link per direction per arm, 4 cells per tile per lane', () => {
    expect(w.links).toHaveLength(8);
    expect(w.lanes).toHaveLength(8);
    const north = w.links[w.edges[0]!.spawnLink]!;
    expect(north.tiles).toEqual([0, 1, 2, 3].map((y) => tileIndex(3, y)));
    expect(north.cells).toBe(16);
    expect(north.to).toEqual({ kind: 'intersection', index: 0 });
    const east = w.links[w.edges[1]!.spawnLink]!;
    expect(east.cells).toBe(12);
    checkInvariants(w);
  });

  it('routes straight and turning movements through the intersection', () => {
    const ns = routeByEdgeId(w, 0, 2)!;
    expect(ns.links).toEqual([w.edges[0]!.spawnLink, w.intersections[0]!.outLinks[2]]);
    expect(ns.tiles).toBe(GRID_HEIGHT);
    expect(routeByEdgeId(w, 0, 1)!.tiles).toBe(4 + 1 + 3);
    expect(route(w, 0, 1)).toBe(route(w, 0, 1)); // cached
  });

  it('locates lane cells on tiles for the renderer', () => {
    const lane = w.links[w.edges[0]!.spawnLink]!.lanes[0]!;
    expect(locateCell(w, lane, 0)).toEqual({
      tile: tileIndex(3, 0),
      offset: 0,
      entryDir: 2,
      exitDir: 2,
    });
    expect(locateCell(w, lane, 5)).toEqual({
      tile: tileIndex(3, 1),
      offset: 1,
      entryDir: 2,
      exitDir: 2,
    });
    expect(() => locateCell(w, lane, 16)).toThrow(RangeError);
    expect(() => locateCell(w, 99, 0)).toThrow(RangeError);
  });

  it('rejects unknown and self routes', () => {
    expect(() => routeByEdgeId(w, 0, 9)).toThrow(RangeError);
    expect(() => route(w, 0, 0)).toThrow(RangeError);
    expect(() => route(w, 0, 7)).toThrow(RangeError);
    expect(edgeIndex(w, 3)).toBe(3);
  });
});

describe('buildWorld on a loop', () => {
  it('has two 3-way intersections and corner tiles that bend links', () => {
    const w = buildWorld(loopMap);
    expect(w.intersections.map((i) => [i.x, i.y, i.approaches])).toEqual([
      [3, 1, 3],
      [3, 5, 3],
    ]);
    const east = w.links[w.intersections[0]!.outLinks[1]!]!;
    expect(east.tiles).toHaveLength(2 + 3 + 2);
    expect(east.exitDirs).toEqual([1, 2, 2, 2, 2, 3, 3]);
    checkInvariants(w);
  });

  it('breaks BFS ties by direction order n, e, s, w (east before west)', () => {
    const w = buildWorld(loopMap);
    const r = routeByEdgeId(w, 10, 20)!;
    expect(r.links[1]).toBe(w.intersections[0]!.outLinks[1]);
    expect(r.tiles).toBe(1 + 1 + 7 + 1 + 3);
  });

  it('respects links without lanes (one-way) and reports unreachable routes', () => {
    const w = buildWorld(loopMap);
    const top = w.intersections[0]!;
    // Close the eastbound side of the loop: the route must go west.
    closeLink(w, top.outLinks[1]!);
    expect(routeByEdgeId(w, 10, 20)!.links[1]).toBe(top.outLinks[3]);
    closeLink(w, top.outLinks[3]!);
    expect(routeByEdgeId(w, 10, 20)).toBeNull();
    expect(routeByEdgeId(w, 10, 20)).toBeNull(); // cached null
    closeLink(w, w.edges[0]!.spawnLink);
    expect(routeByEdgeId(w, 10, 20)).toBeNull();
  });

  it('weighted routes follow costs, forbid U-turns and report unreachable', () => {
    const w = buildWorld(loopMap);
    const top = w.intersections[0]!;
    const dest = edgeIndex(w, 20);
    const eastOut = top.outLinks[1]!;
    const cheap = weightedRoute(w, 0, 0, dest, () => 1)!;
    expect(cheap[0]).toBe(eastOut); // tie on equal cost goes to the lower link id
    const avoidEast = weightedRoute(w, 0, 0, dest, (l) => (l === eastOut ? 50 : 1))!;
    expect(avoidEast[0]).toBe(top.outLinks[3]);
    expect(avoidEast[avoidEast.length - 1]).toBe(w.edges[dest]!.sinkLink);
    // Arriving from the east, the vehicle may not go back east.
    expect(weightedRoute(w, 0, 1, dest, () => 1)![0]).toBe(top.outLinks[3]);
    // From the bottom intersection, going to the bottom edge is direct.
    expect(weightedRoute(w, 1, -1, dest, () => 1)).toEqual([w.edges[dest]!.sinkLink]);
    expect(() => weightedRoute(w, 0, 0, dest, () => 0)).toThrow(RangeError);
    expect(() => weightedRoute(w, 5, 0, dest, () => 1)).toThrow(RangeError);
    for (const l of w.links) closeLink(w, l.id);
    expect(weightedRoute(w, 0, 0, dest, () => 1)).toBeNull();
  });
});

describe('buildWorld edge cases', () => {
  it('builds a one-tile road between two edges on a corner', () => {
    const tiles: MapTile[] = Array.from({ length: GRID_WIDTH * GRID_HEIGHT }, (_, i) =>
      i === 0 ? { kind: 'road', lanes: 2 } : { kind: 'block' },
    );
    const w = buildWorld({
      id: 'corner',
      tiles,
      edges: [
        { id: 0, tile: { x: 0, y: 0 }, side: 'n' },
        { id: 1, tile: { x: 0, y: 0 }, side: 'w' },
      ],
    });
    expect(w.intersections).toHaveLength(0);
    expect(w.links).toHaveLength(2);
    expect(w.lanes).toHaveLength(4);
    expect(route(w, 0, 1)).toEqual({ origin: 0, destination: 1, links: [0], tiles: 1 });
    checkInvariants(w);
  });

  const plus = emptyMap();
  const withTiles = (patch: (tiles: MapTile[]) => void): GridMap => {
    const tiles = [...plus.tiles];
    patch(tiles);
    return { ...plus, tiles };
  };
  const withEdges = (edges: MapEdge[]): GridMap => ({ ...plus, edges });
  const e = plus.edges;

  it.each<[string, GridMap, RegExp]>([
    ['tile count', { ...plus, tiles: plus.tiles.slice(1) }, /62 tiles/],
    [
      'lane count',
      withTiles((t) => (t[tileIndex(3, 0)] = { kind: 'road', lanes: 3 as 1 })),
      /lanes per direction/,
    ],
    ['too few edges', withEdges([e[0]!]), /at least 2 edges/],
    ['edge id range', withEdges([e[0]!, { ...e[1]!, id: 70000 }]), /edge id/],
    ['duplicate edge id', withEdges([e[0]!, { ...e[1]!, id: 0 }]), /duplicate edge id/],
    ['edge outside', withEdges([e[0]!, { ...e[1]!, tile: { x: 7, y: 4 } }]), /outside the grid/],
    ['edge on block', withEdges([e[0]!, { id: 5, tile: { x: 0, y: 0 }, side: 'n' }]), /block tile/],
    [
      'edge not on boundary',
      withEdges([e[0]!, { ...e[1]!, side: 'w' }]),
      /not on the map boundary/,
    ],
    ['two edges one side', withEdges([e[0]!, { ...e[0]!, id: 9 }]), /two edges/],
    ['dead end', withTiles((t) => (t[tileIndex(2, 0)] = { kind: 'road', lanes: 1 })), /exactly 2/],
    [
      'adjacent intersections',
      withTiles((t) => {
        for (const x of [2, 4]) t[tileIndex(x, 5)] = { kind: 'road', lanes: 1 };
      }),
      /adjacent/,
    ],
    [
      'disconnected',
      withTiles((t) => {
        t[tileIndex(0, 0)] = { kind: 'road', lanes: 1 };
        t[tileIndex(1, 0)] = { kind: 'road', lanes: 1 };
      }),
      /exactly 2|not connected/,
    ],
    [
      'lane change mid-road',
      withTiles((t) => (t[tileIndex(3, 1)] = { kind: 'road', lanes: 2 })),
      /lane count changes/,
    ],
  ])('rejects: %s', (_name, map, message) => {
    expect(() => buildWorld(map)).toThrow(MapError);
    expect(() => buildWorld(map)).toThrow(message);
  });

  it('rejects an edge on an intersection tile', () => {
    // (3,0) gets road neighbours w, e and s while edge 0 sits on its north side.
    const map = withTiles((t) => {
      t[tileIndex(2, 0)] = { kind: 'road', lanes: 1 };
      t[tileIndex(4, 0)] = { kind: 'road', lanes: 1 };
    });
    const edges: MapEdge[] = [
      ...map.edges,
      { id: 7, tile: { x: 2, y: 0 }, side: 'n' },
      { id: 8, tile: { x: 4, y: 0 }, side: 'n' },
    ];
    expect(() => buildWorld({ ...map, edges })).toThrow(/edge on intersection/);
  });

  it('rejects a separate component that has its own edges', () => {
    const tiles: MapTile[] = Array.from({ length: GRID_WIDTH * GRID_HEIGHT }, (_, i) =>
      i === 0 || i === GRID_WIDTH - 1 ? { kind: 'road', lanes: 1 } : { kind: 'block' },
    );
    const map: GridMap = {
      id: 'split',
      tiles,
      edges: [
        { id: 0, tile: { x: 0, y: 0 }, side: 'n' },
        { id: 1, tile: { x: 0, y: 0 }, side: 'w' },
        { id: 2, tile: { x: 6, y: 0 }, side: 'n' },
        { id: 3, tile: { x: 6, y: 0 }, side: 'e' },
      ],
    };
    expect(() => buildWorld(map)).toThrow(/not connected/);
  });

  it('maps sides to indices', () => {
    expect(['n', 'e', 's', 'w'].map((s) => sideIndex(s as 'n'))).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map(opposite)).toEqual([2, 3, 0, 1]);
  });
});

describe('property: lattice maps', () => {
  /** Full-length streets on columns {1,3,5} and rows {1,3,5,7}, edges at both ends. */
  const lattice = fc.record({
    cols: fc.subarray([1, 3, 5]),
    rows: fc.subarray([1, 3, 5, 7]),
    colLanes: fc.array(fc.constantFrom<1 | 2>(1, 2), { minLength: 3, maxLength: 3 }),
    rowLanes: fc.array(fc.constantFrom<1 | 2>(1, 2), { minLength: 4, maxLength: 4 }),
  });

  it('every valid lattice builds, and every edge pair has a shortest contiguous route', () => {
    fc.assert(
      fc.property(lattice, ({ cols, rows, colLanes, rowLanes }) => {
        fc.pre(cols.length + rows.length > 0);
        // Parallel streets that never cross are separate components.
        const connected = cols.length + rows.length === 1 || (cols.length > 0 && rows.length > 0);
        const tiles: MapTile[] = [];
        for (let y = 0; y < GRID_HEIGHT; y++) {
          for (let x = 0; x < GRID_WIDTH; x++) {
            const ci = cols.indexOf(x);
            const ri = rows.indexOf(y);
            // On a crossing the tile's own lane count is irrelevant (intersection).
            if (ci >= 0) tiles.push({ kind: 'road', lanes: colLanes[[1, 3, 5].indexOf(x)]! });
            else if (ri >= 0)
              tiles.push({ kind: 'road', lanes: rowLanes[[1, 3, 5, 7].indexOf(y)]! });
            else tiles.push({ kind: 'block' });
          }
        }
        const edges: MapEdge[] = [];
        for (const x of cols) {
          edges.push({ id: edges.length, tile: { x, y: 0 }, side: 'n' });
          edges.push({ id: edges.length, tile: { x, y: GRID_HEIGHT - 1 }, side: 's' });
        }
        for (const y of rows) {
          edges.push({ id: edges.length, tile: { x: 0, y }, side: 'w' });
          edges.push({ id: edges.length, tile: { x: GRID_WIDTH - 1, y }, side: 'e' });
        }
        const map: GridMap = { id: 'lattice', tiles, edges };
        if (!connected) {
          expect(() => buildWorld(map)).toThrow(/not connected/);
          return;
        }
        const w = buildWorld(map);
        expect(w.intersections).toHaveLength(cols.length * rows.length);
        checkInvariants(w);
      }),
      { numRuns: 120 },
    );
  });
});

describe('Sim.init builds the world', () => {
  it('rejects bad maps and demand that names unknown or identical edges', () => {
    const base = sampleInput(1);
    expect(() => Sim.init({ ...base, map: { ...base.map, edges: [] } })).toThrow(RangeError);
    const demand = (edge: number, destinationEdge: number) => ({
      ...base,
      demandProfile: [{ tick: 0, edge, vehicleType: 0 as const, destinationEdge }],
    });
    expect(() => Sim.init(demand(0, 9))).toThrow(/unknown edge id 9/);
    expect(() => Sim.init(demand(9, 0))).toThrow(/unknown edge id 9/);
    expect(() => Sim.init(demand(1, 1))).toThrow(/own destination/);
    expect(Sim.init(demand(1, 2)).tick).toBe(0);
  });
});
