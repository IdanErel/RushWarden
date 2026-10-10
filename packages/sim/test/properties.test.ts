/**
 * GDD section 11 sim invariants as fast-check properties (P1-SIM-06): "no two vehicles share a
 * cell, vehicles never move backward, throughput ≤ spawned, hash stable under re-run".
 *
 * Reading of "throughput ≤ spawned" (accepted by the Lead): throughput is score-weighted (a bus
 * scores 3), so the literal inequality does not hold. The property checked is that each exit is
 * counted once, at its own score (max(0, score + modifier)), and spawned = exited + alive ≤ demand.
 *
 * Rounds come from three sources: `denseInput` (lattices, every vehicle type, p_slow),
 * `cardInput` (Phase 1 cards, so topology, speed and lane effects are covered) and rounds built
 * here from fast-check values (random lattices, controllers of every kind on every intersection,
 * p_slow and a closed segment). Every tick of every round is checked.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ROUND_TICKS,
  Sim,
  cardInput,
  denseInput,
  latticeMap,
  roundWorld,
  type ControllerKind,
  type DemandEvent,
  type Placement,
  type RoundInput,
  type SegmentId,
  type Side,
  type SimState,
  type VehicleType,
  type World,
} from '../src/index.js';
import type { Traffic } from '../src/traffic.js';
import { MAX_VEHICLE_LENGTH, VEHICLE_SPECS } from '../src/vehicles.js';

const GRID_H = 9;
const NONE = -1;

function traffic(s: SimState): Traffic {
  return (s as unknown as { traffic: Traffic }).traffic;
}

/** Where a vehicle was at the end of the previous tick. */
interface Seen {
  lane: number;
  cell: number;
  /** Last road link the vehicle was on (pockets count as their approach link). */
  roadLink: number;
}

/**
 * True when link `b` starts at most two links after link `a` ends (a vehicle moves ≤ 5 cells),
 * without a U-turn: no link on the way is the reverse of the link before it.
 */
function follows(w: World, a: number, b: number): boolean {
  const end = w.links[a]!.to;
  const start = w.links[b]!.from;
  if (end.kind !== 'intersection' || start.kind !== 'intersection') return false;
  if (end.index === start.index) return b !== w.links[a]!.reverse;
  return w.intersections[end.index]!.outLinks.some(
    (m) =>
      m !== NONE &&
      m !== w.links[a]!.reverse &&
      w.links[m]!.to.kind === 'intersection' &&
      w.links[m]!.to.index === start.index &&
      b !== w.links[m]!.reverse,
  );
}

/**
 * Steps a round to the end, checking the invariants after every tick. Returns the final state so
 * callers can compare it.
 */
function runChecked(input: RoundInput): SimState {
  let s = Sim.init(input);
  const t = traffic(s);
  const w = t.world;
  const seen = new Map<number, Seen>();
  let exitedScore = 0;
  let exited = 0;
  let prevSpawned = 0;
  while (!s.done) {
    s = Sim.step(s);
    const alive = new Set<number>();
    const held = new Map<number, number>();
    for (let k = 0; k < t.orderLen; k++) {
      const i = t.order[k]!;
      alive.add(i);
      // No two vehicles share a cell, and `occ` agrees with what each vehicle holds.
      for (let j = 0; j < MAX_VEHICLE_LENGTH; j++) {
        const p = t.tail[i * MAX_VEHICLE_LENGTH + j]!;
        if (p === NONE) continue;
        const other = held.get(p);
        if (other !== undefined)
          throw new Error(`tick ${s.tick}: vehicles ${other} and ${i} share cell ${p}`);
        held.set(p, i);
        if (t.occ[p] !== i + 1) throw new Error(`tick ${s.tick}: occupancy of cell ${p} is stale`);
      }
      const len = VEHICLE_SPECS[t.type[i]!]!.length;
      for (let j = len; j < MAX_VEHICLE_LENGTH; j++)
        if (t.tail[i * MAX_VEHICLE_LENGTH + j] !== NONE)
          throw new Error(`tick ${s.tick}: vehicle ${i} holds more cells than its length`);

      // Vehicles never move backward.
      const lane = w.lanes[t.lane[i]!]!;
      const cell = t.cell[i]!;
      const prev = seen.get(i);
      const roadLink = lane.kind === 'box' ? NONE : lane.link;
      if (prev === undefined) {
        // Spawned this tick on cell 0 of its spawn link, then moved at most 1 cell (v from 0).
        expect(lane.kind).toBe('road');
        expect(cell).toBeLessThanOrEqual(1);
        expect(t.speed[i]).toBe(cell);
        seen.set(i, { lane: lane.id, cell, roadLink });
        continue;
      }
      const back = (): never => {
        throw new Error(
          `tick ${s.tick}: vehicle ${i} moved backward from lane ${prev.lane} cell ${prev.cell} to lane ${lane.id} cell ${cell}`,
        );
      };
      if (lane.id === prev.lane) {
        if (cell < prev.cell) back();
        if (t.speed[i] !== cell - prev.cell) back();
      } else if (lane.kind === 'box') {
        // Into the box of the intersection its last road link (or pocket) ends at, on a movement
        // entered from that link's side, and never a U-turn.
        const from = w.links[prev.roadLink]!;
        if (from.to.kind !== 'intersection' || from.to.index !== lane.intersection) back();
        if (lane.entryDir !== from.exitDirs[from.exitDirs.length - 1]) back();
        if (lane.exitDir === ((lane.entryDir + 2) & 3)) back();
      } else if (lane.kind === 'pocket') {
        if (lane.link !== prev.roadLink || w.lanes[prev.lane]!.kind !== 'road') back();
      } else if (lane.link === prev.roadLink || !follows(w, prev.roadLink, lane.link)) {
        back();
      } else if (w.lanes[prev.lane]!.kind === 'box') {
        // Out of the box onto the link its movement leads to (the box's exit side).
        const box = w.lanes[prev.lane]!;
        const link = w.links[lane.link]!;
        const start = link.from;
        if (start.kind !== 'intersection' || start.index !== box.intersection) back();
        if (link.entryDirs[0] !== box.exitDir) back();
      }
      prev.lane = lane.id;
      prev.cell = cell;
      if (roadLink !== NONE) prev.roadLink = roadLink;
    }
    // Vehicles that left this tick reached the sink: each scores its value once.
    for (const i of seen.keys()) {
      if (alive.has(i)) continue;
      seen.delete(i);
      exited++;
      const vt = t.type[i]!;
      exitedScore += Math.max(0, VEHICLE_SPECS[vt]!.score + t.scoreDelta[vt]!);
    }
    // Throughput ≤ spawned: only spawned vehicles exit, each once, scoring its own value.
    expect(t.exited).toBe(exited);
    expect(t.throughput).toBe(exitedScore);
    expect(t.exited + t.orderLen).toBe(t.spawned);
    expect(t.spawned).toBeGreaterThanOrEqual(prevSpawned);
    expect(t.spawned).toBeLessThanOrEqual(t.demand.length);
    prevSpawned = t.spawned;
    // Every occupied cell belongs to a vehicle.
    let occupied = 0;
    for (let p = 0; p < t.occ.length; p++) if (t.occ[p] !== 0) occupied++;
    expect(occupied).toBe(held.size);
  }
  return s;
}

const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const KINDS: readonly ControllerKind[] = [
  'uncontrolled',
  'signal',
  'roundabout',
  'stop-all',
  'priority',
];

/**
 * A non-empty subset of `options`, sorted. Roads two tiles apart or more, so no two parallel roads
 * touch (every road tile then has exactly two neighbours or is an intersection).
 */
const lines = (options: readonly number[]) => fc.subarray([...options], { minLength: 1 });

/** Rounds built from fast-check values: lattice, demand, controllers, p_slow and a closure. */
const builtRound = fc
  .record({
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    cols: lines([1, 3, 5]),
    rows: lines([1, 3, 5, 7]),
    rowLanes: fc.constantFrom<1 | 2>(1, 2),
    demand: fc.array(
      fc.record({
        tick: fc.integer({ min: 0, max: ROUND_TICKS - 1 }),
        edge: fc.nat(),
        dest: fc.nat(),
        vehicleType: fc.integer({ min: 0, max: 5 }),
      }),
      { maxLength: 150 },
    ),
    controllers: fc.array(
      fc.record({
        kind: fc.constantFrom(...KINDS),
        side: fc.constantFrom(...SIDES),
        adaptive: fc.boolean(),
      }),
      { minLength: 16, maxLength: 16 },
    ),
    pSlow: fc.constantFrom(0, 0, 100, 250, 1000),
    close: fc.option(fc.nat(), { nil: undefined }),
  })
  .map(({ seed, cols, rows, rowLanes, demand, controllers, pSlow, close }): RoundInput => {
    const map = latticeMap(
      `prop-${cols.join('')}-${rows.join('')}-${rowLanes}`,
      cols,
      rows,
      rowLanes,
    );
    const n = map.edges.length;
    const demandProfile: DemandEvent[] = demand
      .map((d) => {
        const edge = d.edge % n;
        const destinationEdge = (edge + 1 + (d.dest % (n - 1))) % n;
        return { tick: d.tick, edge, destinationEdge, vehicleType: d.vehicleType as VehicleType };
      })
      .sort((a, b) => a.tick - b.tick || a.edge - b.edge);
    const placements: Placement[] = [];
    let k = 0;
    for (const x of cols)
      for (const y of rows) {
        const c = controllers[k % controllers.length]!;
        placements.push({
          cardId: `ctrl-${k}`,
          tier: 1,
          target: { kind: 'intersection', tile: { x, y } },
          effects: [
            { kind: 'setController', controller: c.kind, direction: c.side },
            ...(c.kind === 'signal' && c.adaptive
              ? [{ kind: 'setSignalPhase' as const, mode: 'adaptive' as const }]
              : []),
          ],
          order: k++,
        });
      }
    // A closed segment: one plain road tile of a column, between rows (never an intersection).
    let closedSegments: SegmentId[] | undefined;
    if (close !== undefined) {
      const x = cols[close % cols.length]!;
      const free = Array.from({ length: GRID_H }, (_, y) => y).filter((y) => !rows.includes(y));
      const y = free[close % free.length]!;
      closedSegments = [{ from: { x, y }, to: { x, y } }];
    }
    return {
      seed,
      mapId: map.id,
      map,
      demandProfile,
      placements,
      cardState: { runEffects: [] },
      districtRules: {
        district: 1,
        round: 1,
        rush: false,
        boss: null,
        quota: 26,
        pSlowPermille: pSlow,
      },
      ...(closedSegments ? { closedSegments } : {}),
    };
  });

const seed = fc.integer({ min: 0, max: 0xffffffff });
const anyRound = fc.oneof(seed.map(denseInput), seed.map(cardInput), builtRound);

describe('sim invariants (GDD section 11, fast-check)', () => {
  it('no shared cells, never backward, throughput ≤ spawned: dense rounds', () => {
    fc.assert(
      fc.property(seed, (sd) => void runChecked(denseInput(sd))),
      { numRuns: 20 },
    );
  });

  it('no shared cells, never backward, throughput ≤ spawned: rounds with Phase 1 cards', () => {
    fc.assert(
      fc.property(seed, (sd) => void runChecked(cardInput(sd))),
      { numRuns: 20 },
    );
  });

  it('no shared cells, never backward, throughput ≤ spawned: random maps, controllers, closures', () => {
    fc.assert(
      fc.property(builtRound, (input) => void runChecked(input)),
      { numRuns: 30 },
    );
  });

  it('hash stable under re-run: simulate, stepping and recorded frames agree', () => {
    fc.assert(
      fc.property(anyRound, (input) => {
        const a = Sim.simulate(input);
        const b = Sim.simulate(structuredClone(input));
        expect(b).toEqual(a);
        expect(Sim.stateHash(runChecked(input))).toBe(a.finalHash);
        const framed = Sim.simulate({ ...input, recordFrames: true });
        expect(framed.finalHash).toBe(a.finalHash);
        expect(framed.frames).toHaveLength(a.ticks);
      }),
      { numRuns: 20 },
    );
  });

  it('a round on a fresh map object and a cached one give the same result', () => {
    fc.assert(
      fc.property(anyRound, (input) => {
        roundWorld(input); // warm the world cache for this map object
        expect(Sim.simulate({ ...input, map: structuredClone(input.map) })).toEqual(
          Sim.simulate(input),
        );
      }),
      { numRuns: 15 },
    );
  });
});
