import {
  type DemandProfile,
  type RoundInput,
  segmentTiles,
  Sim,
  VehicleType,
} from '@rushwarden/sim';
import { describe, expect, it } from 'vitest';
import {
  DISTRICT_DEMAND,
  districtMaps,
  generateDemand,
  heatStrip,
  MARKET_DAY_TRUCKS_PER_SECOND,
  mixCounts,
  ROUND_SECONDS,
  roundQuota,
  roundVehicles,
  SECOND_WEIGHTS,
  setupRound,
  setupRoundFrom,
  edgesConnectedWithout,
  interiorSegments,
  paradeCandidates,
  pickParadeSegment,
  rowsToGridMap,
  SEED_SALTS,
} from '../src/index.js';

const maps = districtMaps(1);
const map = maps[0]!;

function typeCounts(p: DemandProfile): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of p) out[e.vehicleType] = (out[e.vehicleType] ?? 0) + 1;
  return out;
}

function inputFor(s: ReturnType<typeof setupRound>, seed: number): RoundInput {
  return {
    seed,
    mapId: s.map.id,
    map: s.map,
    demandProfile: s.demandProfile,
    placements: [],
    cardState: { runEffects: [] },
    districtRules: s.districtRules,
    closedSegments: s.closedSegments,
  };
}

describe('quota (GDD §2)', () => {
  it('matches base[d] * (1 + 0.11*(r-1)) * rushMult, rounded, for every round and district', () => {
    const base = { 1: 26, 2: 34, 3: 42 } as const;
    for (const d of [1, 2, 3] as const) {
      for (let r = 1; r <= 12; r++) {
        for (const rush of [false, true]) {
          const exact = base[d] * (1 + 0.11 * (r - 1)) * (rush ? 1.6 : 1);
          expect(roundQuota(d, r, rush)).toBe(Math.round(exact));
        }
      }
    }
  });

  it('starts District 1 at 26 and applies a mayor modifier', () => {
    expect(roundQuota(1, 1, false)).toBe(26);
    expect(roundQuota(1, 4, true)).toBe(55);
    expect(roundQuota(1, 1, false, 1100)).toBe(29);
  });
});

describe('demand volume and mix (GDD §5)', () => {
  it('grows with the quota and 1.6× on rush rounds', () => {
    expect(roundVehicles(1, 1, false)).toBe(28);
    expect(roundVehicles(1, 2, false)).toBe(31);
    expect(roundVehicles(1, 4, true)).toBe(60);
    expect(roundVehicles(1, 12, true)).toBe(99);
    // Festival: +60% on top of rush (28 * 2.21 * 1.6 * 1.6 = 158.4).
    expect(roundVehicles(1, 12, true, 'festival')).toBe(158);
    expect(roundVehicles(1, 4, true, 'market-day')).toBe(60);
  });

  it('splits counts exactly by the per-mille mix, leftovers to the largest remainders', () => {
    const mix = DISTRICT_DEMAND[1].mix;
    expect(Object.fromEntries(mixCounts(100, mix))).toEqual({
      [VehicleType.Car]: 70,
      [VehicleType.Bus]: 15,
      [VehicleType.Truck]: 10,
      [VehicleType.Bike]: 5,
    });
    // 28: car 19.6, bus 4.2, truck 2.8, bike 1.4 → 19+4+2+1 = 26, +1 car (.6), +1 truck (.8).
    expect(Object.fromEntries(mixCounts(28, mix))).toEqual({
      [VehicleType.Car]: 20,
      [VehicleType.Bus]: 4,
      [VehicleType.Truck]: 3,
      [VehicleType.Bike]: 1,
    });
    for (let n = 0; n <= 150; n++) {
      expect([...mixCounts(n, mix).values()].reduce((a, b) => a + b, 0)).toBe(n);
    }
    expect(mixCounts(3, { Car: 500, Bus: 500 }).get(VehicleType.Car)).toBe(2);
  });

  it('the mix of a generated round is exact and only uses D1 types', () => {
    const p = generateDemand({ map, district: 1, round: 1, rush: false, boss: null, seed: 7 });
    expect(p).toHaveLength(28);
    expect(typeCounts(p)).toEqual(Object.fromEntries(mixCounts(28, DISTRICT_DEMAND[1].mix)));
  });

  it('the spawn-time curve covers all 15 seconds', () => {
    expect(SECOND_WEIGHTS).toHaveLength(ROUND_SECONDS);
    expect(SECOND_WEIGHTS.every((w) => w > 0)).toBe(true);
  });
});

describe('generateDemand', () => {
  const args = { map, district: 1 as const, round: 3, rush: false, boss: null, seed: 1234 };

  it('is deterministic in its arguments and changes with the seed', () => {
    expect(generateDemand(args)).toEqual(generateDemand(args));
    expect(generateDemand(args)).not.toEqual(generateDemand({ ...args, seed: 1235 }));
  });

  it('is sorted by (tick, edge), unique per (tick, edge), in range, never to its own edge', () => {
    const edges = new Set(map.edges.map((e) => e.id));
    for (let seed = 0; seed < 200; seed++) {
      const p = generateDemand({ ...args, seed, round: 1 + (seed % 12), rush: seed % 3 === 0 });
      const keys = new Set<string>();
      p.forEach((e, i) => {
        const prev = p[i - 1];
        if (prev)
          expect(prev.tick < e.tick || (prev.tick === e.tick && prev.edge < e.edge)).toBe(true);
        expect(e.tick).toBeGreaterThanOrEqual(0);
        expect(e.tick).toBeLessThan(300);
        expect(Number.isInteger(e.tick)).toBe(true);
        expect(edges.has(e.edge) && edges.has(e.destinationEdge)).toBe(true);
        expect(e.destinationEdge).not.toBe(e.edge);
        keys.add(`${e.tick}/${e.edge}`);
      });
      expect(keys.size).toBe(p.length);
    }
  });

  it('Market Day adds 2 trucks in every second on top of the rush demand', () => {
    const plain = generateDemand({ ...args, round: 4, rush: true, boss: null });
    const market = generateDemand({ ...args, round: 4, rush: true, boss: 'market-day' });
    const extra = MARKET_DAY_TRUCKS_PER_SECOND * ROUND_SECONDS;
    expect(market.length - plain.length).toBe(extra);
    expect(typeCounts(market)[VehicleType.Truck]! - typeCounts(plain)[VehicleType.Truck]!).toBe(
      extra,
    );
    const strip = heatStrip(map, market);
    for (let s = 0; s < ROUND_SECONDS; s++) {
      const inSecond = strip.rows.reduce((n, r) => n + r.perSecond[s]!, 0);
      expect(inSecond).toBeGreaterThanOrEqual(MARKET_DAY_TRUCKS_PER_SECOND);
    }
  });

  it('finds a free tick when an edge is crowded', () => {
    const two = { ...map, id: 'two', edges: map.edges.slice(0, 2) };
    const p = generateDemand({ ...args, map: two, round: 12, rush: true, boss: 'market-day' });
    expect(new Set(p.map((e) => `${e.tick}/${e.edge}`)).size).toBe(p.length);
  });

  it('rejects a map with fewer than 2 edges', () => {
    expect(() =>
      generateDemand({ ...args, map: { ...map, edges: map.edges.slice(0, 1) } }),
    ).toThrow('needs at least 2 edges');
  });
});

describe('heatStrip (GDD §2)', () => {
  it('counts spawns per edge per second, in map edge order, with the max for scaling', () => {
    const p = generateDemand({ map, district: 1, round: 5, rush: false, boss: null, seed: 99 });
    const strip = heatStrip(map, p);
    expect(strip.rows.map((r) => r.edge)).toEqual(map.edges.map((e) => e.id));
    expect(strip.rows.every((r) => r.perSecond.length === ROUND_SECONDS)).toBe(true);
    expect(strip.rows.reduce((n, r) => n + r.perSecond.reduce((a, b) => a + b, 0), 0)).toBe(
      p.length,
    );
    expect(strip.max).toBe(Math.max(...strip.rows.flatMap((r) => r.perSecond)));
    for (const e of p)
      expect(
        strip.rows.find((r) => r.edge === e.edge)!.perSecond[Math.floor(e.tick / 20)],
      ).toBeGreaterThan(0);
  });

  it('is empty for no demand and rejects an unknown edge', () => {
    expect(heatStrip(map, []).max).toBe(0);
    expect(() =>
      heatStrip(map, [{ tick: 0, edge: 999, vehicleType: VehicleType.Car, destinationEdge: 0 }]),
    ).toThrow('demand edge 999');
  });
});

describe('setupRound', () => {
  it('gives the run controller a map and demand that Sim.init accepts, every round', () => {
    for (let seed = 0; seed < 120; seed++) {
      const round = 1 + (seed % 12);
      const rush = round === 4 || round === 5;
      const s = setupRound({
        district: 1,
        round,
        rush,
        boss: rush ? 'market-day' : null,
        seed: (seed * 2654435761) >>> 0,
      });
      expect(maps.map((m) => m.id)).toContain(s.map.id);
      expect(() => Sim.init(inputFor(s, (seed * 2654435761) >>> 0))).not.toThrow();
    }
  });

  it('is deterministic and picks across the map bank', () => {
    expect(setupRound({ round: 2, seed: 42 })).toEqual(setupRound({ round: 2, seed: 42 }));
    const picked = new Set(
      Array.from({ length: 200 }, (_, i) => setupRound({ round: 1, seed: i }).map.id),
    );
    expect(picked.size).toBeGreaterThan(20);
  });

  it('returns the quota, heat-strip and district rules for the round', () => {
    const s = setupRound({ round: 5, rush: true, boss: 'market-day', seed: 3 });
    expect(s.quota).toBe(roundQuota(1, 5, true));
    expect(s.districtRules).toEqual({
      district: 1,
      round: 5,
      rush: true,
      boss: 'market-day',
      quota: s.quota,
      pSlowPermille: 0,
    });
    expect(s.heatStrip).toEqual(heatStrip(s.map, s.demandProfile));
  });

  it('defaults rush and boss from GDD §2/§5: round 4 is a Market Day rush round', () => {
    const r4 = setupRound({ round: 4, seed: 11 });
    expect(r4.districtRules.rush).toBe(true);
    expect(r4.districtRules.boss).toBe('market-day');
    expect(setupRound({ round: 3, seed: 11 }).districtRules).toMatchObject({
      rush: false,
      boss: null,
    });
    expect(
      setupRound({ round: 4, rush: true, boss: null, seed: 11 }).districtRules.boss,
    ).toBeNull();
  });

  it('refuses what Phase 1 does not have yet, and bad arguments', () => {
    expect(() => setupRound({ round: 4, rush: true, boss: 'convoy', seed: 1 })).toThrow(
      'boss "convoy" is not implemented yet',
    );
    expect(() => setupRound({ district: 2, round: 1, seed: 1 })).toThrow('District 2');
    expect(() => setupRound({ round: 1, rush: false, boss: 'market-day', seed: 1 })).toThrow(
      'needs a rush round',
    );
    expect(() => setupRound({ round: 0, seed: 1 })).toThrow('bad round');
    expect(() => setupRound({ round: 1, seed: -1 })).toThrow('uint32');
  });

  it('setupRoundFrom uses the given map bank and picker', () => {
    const s = setupRoundFrom(
      { round: 1, seed: 5 },
      () => [map],
      (m) => m[0]!,
    );
    expect(s.map).toBe(map);
  });
});

describe('Festival (GDD §5: all demand +60%, emergency vehicles appear)', () => {
  it('spawns 1.6× the rush demand with 5% emergency vehicles taken from cars', () => {
    const args = { map, district: 1 as const, round: 12, rush: true, seed: 77 };
    const plain = generateDemand({ ...args, boss: null });
    const fest = generateDemand({ ...args, boss: 'festival' });
    expect(plain).toHaveLength(99);
    expect(fest).toHaveLength(158);
    expect(typeCounts(fest)).toEqual(
      Object.fromEntries(mixCounts(158, DISTRICT_DEMAND[1].festival.mix)),
    );
    expect(typeCounts(fest)[VehicleType.Emergency]).toBe(8);
    expect(typeCounts(plain)[VehicleType.Emergency]).toBeUndefined();
  });

  it('is the default round 12 boss and Sim.init accepts it', () => {
    const s = setupRound({ round: 12, seed: 5 });
    expect(s.districtRules.boss).toBe('festival');
    expect(s.closedSegments).toEqual([]);
    expect(() => Sim.init(inputFor(s, 5))).not.toThrow();
  });
});

describe('Parade (GDD §5: one segment closed)', () => {
  it('tree-shaped maps have no closable segment; the rest do', () => {
    const none = maps.filter((m) => paradeCandidates(m).length === 0).map((m) => m.id);
    expect(none.map((id) => id.slice(0, 5)).filter((t, i, all) => all.indexOf(t) === i)).toEqual([
      'd1-02',
      'd1-05',
      'd1-09',
      'd1-10',
    ]);
    expect(maps.length - none.length).toBe(24);
  });

  it('Parade rounds only pick maps with a closable segment, and Sim.init accepts the closure', () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = setupRound({ round: 8, seed });
      expect(paradeCandidates(s.map).length).toBeGreaterThan(0);
      expect(s.closedSegments).toHaveLength(1);
      expect(Object.keys(s.closedSegments[0]!).sort()).toEqual(['from', 'to']);
      expect(() => Sim.init(inputFor(s, seed))).not.toThrow();
    }
  });

  it('every candidate on every map is a closure Sim.init accepts (ADR-022)', () => {
    for (const m of maps) {
      for (const seg of paradeCandidates(m)) {
        const s = { ...setupRound({ round: 1, seed: 1 }), map: m, closedSegments: [seg] };
        expect(() => Sim.init({ ...inputFor(s, 1), demandProfile: [] }), m.id).not.toThrow();
      }
    }
  });

  it('candidates are straight runs of non-intersection road tiles between two intersections', () => {
    for (const m of maps) {
      for (const seg of interiorSegments(m)) {
        expect(seg.from.x === seg.to.x || seg.from.y === seg.to.y).toBe(true);
        const tiles = segmentTiles({ kind: 'segment', ...seg }, m);
        expect(tiles).not.toBeNull();
        for (const t of tiles!) expect(m.tiles[t.y * 7 + t.x]!.kind).toBe('road');
        const inter = new Set(
          m.tiles.flatMap((t, i) => {
            const x = i % 7;
            const y = (i - x) / 7;
            const n = [
              [x, y - 1],
              [x + 1, y],
              [x, y + 1],
              [x - 1, y],
            ].filter(
              ([a, b]) =>
                a! >= 0 && a! < 7 && b! >= 0 && b! < 9 && m.tiles[b! * 7 + a!]!.kind === 'road',
            );
            return t.kind === 'road' && n.length >= 3 ? [`${x},${y}`] : [];
          }),
        );
        for (const t of tiles!) expect(inter.has(`${t.x},${t.y}`)).toBe(false);
        expect(seg.from.y * 7 + seg.from.x).toBeLessThanOrEqual(seg.to.y * 7 + seg.to.x);
        const edgeTiles = new Set(m.edges.map((e) => `${e.tile.x},${e.tile.y}`));
        expect(edgeTiles.has(`${seg.from.x},${seg.from.y}`)).toBe(false);
        expect(edgeTiles.has(`${seg.to.x},${seg.to.y}`)).toBe(false);
      }
    }
  });

  it('rejects a closure that would disconnect the edges', () => {
    // A closure covering an edge's only road disconnects it.
    const e = map.edges[0]!;
    const cut = { from: e.tile, to: e.tile };
    expect(edgesConnectedWithout(map, cut)).toBe(false);
    expect(edgesConnectedWithout({ ...map, edges: [] }, cut)).toBe(true);
  });

  it('round 8 returns one seeded closed segment and keeps the plain rush demand', () => {
    const s = setupRound({ round: 8, seed: 21 });
    expect(s.districtRules).toMatchObject({ rush: true, boss: 'parade' });
    expect(s.closedSegments).toHaveLength(1);
    expect(paradeCandidates(s.map)).toContainEqual(s.closedSegments[0]);
    expect(s.closedSegments[0]).toEqual(pickParadeSegment(s.map, (21 ^ SEED_SALTS.parade) >>> 0));
    expect(s.demandProfile).toHaveLength(roundVehicles(1, 8, true));
    expect(setupRound({ round: 8, seed: 21 })).toEqual(s);
    expect(() => Sim.init(inputFor(s, 21))).not.toThrow();
  });

  it('non-Parade rounds close nothing; the pick varies with the seed', () => {
    expect(setupRound({ round: 7, seed: 21 }).closedSegments).toEqual([]);
    const picks = new Set(
      Array.from({ length: 50 }, (_, i) => JSON.stringify(pickParadeSegment(map, i))),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it('throws on a map with no closable segment', () => {
    const rows = [
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
    ];
    const straight = rowsToGridMap('straight', rows);
    expect(paradeCandidates(straight)).toEqual([]);
    expect(() => pickParadeSegment(straight, 1)).toThrow('no segment a Parade can close');
  });
});
