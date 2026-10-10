/**
 * Round setup for the run controller: the round's map, its seeded demand profile, the heat-strip
 * the player sees before Go, and the quota (GDD §2, §3, §5; P1-CON-04).
 *
 * Everything here is a pure function of its arguments: the only randomness is `createPrng` from
 * @rushwarden/sim, seeded from the round seed. All arithmetic is integer, like the sim.
 */
import {
  type BossCondition,
  createPrng,
  type DemandEvent,
  type DemandProfile,
  type DistrictRules,
  type GridMap,
  idiv,
  nextInt,
  type PrngState,
  ROUND_TICKS,
  TICKS_PER_SECOND,
  VehicleType,
} from '@rushwarden/sim';
import type { District } from './maps.js';

/** Seconds in one Go phase (15). */
export const ROUND_SECONDS = idiv(ROUND_TICKS, TICKS_PER_SECOND);

/** GDD §2: `base = [26, 34, 42]`. */
export const BASE_QUOTA: { readonly [D in District]: number } = { 1: 26, 2: 34, 3: 42 };
/** GDD §2: quota grows 11% per round (`1 + 0.11*(r-1)`), in per-mille. */
export const ROUND_GROWTH_PERMILLE = 110;
/** GDD §2: rush rounds have 1.6× demand and quota, in per-mille. */
export const RUSH_PERMILLE = 1600;
/** GDD §2: rounds 4, 8 and 12 are rush rounds. */
export const RUSH_ROUNDS: readonly number[] = [4, 8, 12];

/** Per-mille shares of each vehicle type in a district's demand (GDD §5 "Demand mix"). */
export type DemandMix = Readonly<Partial<Record<keyof typeof VehicleType, number>>>;

export interface DistrictDemand {
  /** Vehicles spawned in round 1 before growth and rush; tuned by P1-CON-05. */
  readonly baseVehicles: number;
  readonly mix: DemandMix;
  /** GDD §5 rush-round bosses for rounds 4, 8 and 12. */
  readonly bosses: readonly [BossCondition, BossCondition, BossCondition];
}

/**
 * Demand per district. Only District 1 has maps in Phase 1 (ADR-007).
 *
 * `baseVehicles: 28` is a starting value, not a tuned one. With D1's mix, the mean score per
 * vehicle is 1.4 (bus 3, truck 2, car and bike 1), so round 1 can score about 39 against a
 * quota of 26. Demand grows with the quota (11% a round) and the map does not, so congestion
 * rises each round. P1-CON-05 tunes the value from the balance report.
 */
export const DISTRICT_DEMAND: { readonly 1: DistrictDemand } = {
  1: {
    baseVehicles: 28,
    mix: { Car: 700, Bus: 150, Truck: 100, Bike: 50 },
    bosses: ['market-day', 'parade', 'festival'],
  },
};

/**
 * Relative spawn weight per second of the round: a rush-hour peak around seconds 4–7 that tails
 * off, because a vehicle spawned in the last seconds rarely reaches a sink before the round ends.
 */
export const SECOND_WEIGHTS: readonly number[] = [2, 4, 6, 8, 9, 10, 10, 9, 8, 7, 5, 4, 3, 2, 1];

/** Each edge gets a seeded weight in [1, 3] per round, so some edges run hot (§2 heat-strip). */
export const EDGE_WEIGHT_MAX = 3;

/** GDD §5 Market Day: "+2 truck spawns/s", on top of the rush round's demand. */
export const MARKET_DAY_TRUCKS_PER_SECOND = 2;

/** Bosses `setupRound` can produce; the others need work outside P1-CON-04. */
export const SUPPORTED_BOSSES: readonly BossCondition[] = ['market-day'];

/** Salts so the map pick, the demand and the sim's own PRNG use different streams. */
const MAP_SALT = 0x6d617073;
const DEMAND_SALT = 0x64656d64;

/**
 * `quota = base[d] * (1 + 0.11*(r-1)) * rushMult` (GDD §2) in per-mille integers, rounded half
 * up, the same reading as the run controller (ADR-018 item 5). `quotaPermille` is a mayor
 * modifier (1000 = none).
 */
export function roundQuota(
  district: District,
  round: number,
  rush: boolean,
  quotaPermille = 1000,
): number {
  const num =
    BASE_QUOTA[district] *
    (1000 + ROUND_GROWTH_PERMILLE * (round - 1)) *
    (rush ? RUSH_PERMILLE : 1000) *
    quotaPermille;
  const den = 1_000_000_000;
  return idiv(num + idiv(den, 2), den);
}

/** Vehicles in a round's base demand (Market Day trucks come on top). Rounded half up. */
export function roundVehicles(district: 1, round: number, rush: boolean): number {
  const num =
    DISTRICT_DEMAND[district].baseVehicles *
    (1000 + ROUND_GROWTH_PERMILLE * (round - 1)) *
    (rush ? RUSH_PERMILLE : 1000);
  return idiv(num + 500_000, 1_000_000);
}

const TYPE_ORDER = Object.keys(VehicleType) as (keyof typeof VehicleType)[];

/**
 * Exact type counts for `n` vehicles: each type gets its per-mille share rounded down, and the
 * leftover vehicles go to the largest remainders (ties in `VehicleType` order).
 */
export function mixCounts(n: number, mix: DemandMix): Map<VehicleType, number> {
  const rows = TYPE_ORDER.map((name, order) => {
    const share = mix[name] ?? 0;
    return {
      type: VehicleType[name],
      order,
      count: idiv(n * share, 1000),
      rem: (n * share) % 1000,
    };
  });
  let left = n - rows.reduce((s, r) => s + r.count, 0);
  const byRem = [...rows].sort((a, b) => b.rem - a.rem || a.order - b.order);
  for (const r of byRem) {
    if (left <= 0) break;
    if (r.rem === 0) continue;
    r.count += 1;
    left -= 1;
  }
  return new Map(rows.filter((r) => r.count > 0).map((r) => [r.type, r.count]));
}

function weightedIndex(prng: PrngState, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = nextInt(prng, total);
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    if (roll < w) return i;
    roll -= w;
  }
  return weights.length - 1;
}

function shuffle<T>(prng: PrngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(prng, i + 1);
    const a = items[i] as T;
    items[i] = items[j] as T;
    items[j] = a;
  }
  return items;
}

/** Builds the events, keeping (tick, edge) unique so an edge never spawns twice in one tick. */
class Spawner {
  readonly events: DemandEvent[] = [];
  private readonly used = new Set<number>();
  constructor(
    private readonly prng: PrngState,
    private readonly edges: readonly number[],
    private readonly edgeWeights: readonly number[],
  ) {}

  add(second: number, vehicleType: VehicleType): void {
    const e = weightedIndex(this.prng, this.edgeWeights);
    const edge = this.edges[e] ?? 0;
    // Destination: uniform over the other edges (every pair is routable, P1-CON-03).
    let d = nextInt(this.prng, this.edges.length - 1);
    if (d >= e) d += 1;
    const destinationEdge = this.edges[d] ?? 0;
    const start = second * TICKS_PER_SECOND + nextInt(this.prng, TICKS_PER_SECOND);
    // Probe forward from the drawn tick, wrapping over the whole round, for a free (tick, edge).
    for (let k = 0; k < ROUND_TICKS; k++) {
      const tick = (start + k) % ROUND_TICKS;
      const key = tick * 1024 + edge;
      if (this.used.has(key)) continue;
      this.used.add(key);
      this.events.push({ tick, edge, vehicleType, destinationEdge });
      return;
    }
    throw new RangeError(`edge ${edge} has no free spawn tick`);
  }
}

export interface DemandArgs {
  readonly map: GridMap;
  readonly district: 1;
  readonly round: number;
  readonly rush: boolean;
  readonly boss: BossCondition | null;
  readonly seed: number;
}

/**
 * The round's demand profile, sorted by (tick, edge), unique per (tick, edge), every destination
 * a different edge. Deterministic in its arguments.
 */
export function generateDemand(a: DemandArgs): DemandProfile {
  if (a.map.edges.length < 2) throw new RangeError(`map ${a.map.id} needs at least 2 edges`);
  const prng = createPrng((a.seed ^ DEMAND_SALT) >>> 0);
  const edges = a.map.edges.map((e) => e.id);
  const edgeWeights = edges.map(() => 1 + nextInt(prng, EDGE_WEIGHT_MAX));
  const spawner = new Spawner(prng, edges, edgeWeights);

  const types: VehicleType[] = [];
  for (const [type, count] of mixCounts(
    roundVehicles(a.district, a.round, a.rush),
    DISTRICT_DEMAND[a.district].mix,
  )) {
    for (let i = 0; i < count; i++) types.push(type);
  }
  for (const type of shuffle(prng, types)) spawner.add(weightedIndex(prng, SECOND_WEIGHTS), type);

  if (a.boss === 'market-day') {
    for (let s = 0; s < ROUND_SECONDS; s++) {
      for (let i = 0; i < MARKET_DAY_TRUCKS_PER_SECOND; i++) spawner.add(s, VehicleType.Truck);
    }
  }
  return spawner.events.sort((x, y) => x.tick - y.tick || x.edge - y.edge);
}

/** One edge's row of the heat-strip: spawns per second of the round. */
export interface HeatStripRow {
  readonly edge: number;
  readonly perSecond: readonly number[];
}

export interface HeatStrip {
  /** In `map.edges` order. */
  readonly rows: readonly HeatStripRow[];
  /** The largest per-second count over all edges, for scaling the strip (0 if no demand). */
  readonly max: number;
}

/** GDD §2 "a 15-second heat-strip per edge": spawns per edge per second, from the profile. */
export function heatStrip(map: GridMap, profile: DemandProfile): HeatStrip {
  const rows = map.edges.map((e) => ({
    edge: e.id,
    perSecond: new Array<number>(ROUND_SECONDS).fill(0),
  }));
  const byEdge = new Map(rows.map((r) => [r.edge, r.perSecond]));
  for (const ev of profile) {
    const row = byEdge.get(ev.edge);
    if (row === undefined) throw new RangeError(`demand edge ${ev.edge} is not on map ${map.id}`);
    const s = idiv(ev.tick, TICKS_PER_SECOND);
    row[s] = (row[s] ?? 0) + 1;
  }
  const max = rows.reduce((m, r) => Math.max(m, ...r.perSecond), 0);
  return { rows, max };
}

export interface SetupRoundArgs {
  /** Only District 1 has maps and demand in Phase 1. Defaults to 1. */
  readonly district?: District;
  /** 1-based. */
  readonly round: number;
  /** Defaults to GDD §2: rounds 4, 8 and 12. */
  readonly rush?: boolean;
  /** Defaults to the district's §5 boss for rush rounds 4, 8 and 12, else none. */
  readonly boss?: BossCondition | null;
  /** uint32 round seed. */
  readonly seed: number;
}

export interface RoundSetup {
  readonly map: GridMap;
  readonly demandProfile: DemandProfile;
  readonly heatStrip: HeatStrip;
  /** GDD §2 quota with no mayor modifier. */
  readonly quota: number;
  readonly districtRules: DistrictRules;
}

/**
 * `setupRound` with the map bank and picker passed in (the index binds the bundled ones).
 * Sets up one round from its seed: map, demand, heat-strip, quota and district rules.
 */
export function setupRoundFrom(
  args: SetupRoundArgs,
  maps: (district: District) => readonly GridMap[],
  pick: (maps: readonly GridMap[], seed: number) => GridMap,
): RoundSetup {
  const district = args.district ?? 1;
  if (district !== 1) throw new RangeError(`District ${district} has no demand data yet`);
  const { round, seed } = args;
  if (!Number.isInteger(round) || round < 1) throw new RangeError(`bad round ${round}`);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`seed must be a uint32, got ${seed}`);
  }
  const rushIndex = RUSH_ROUNDS.indexOf(round);
  const rush = args.rush ?? rushIndex >= 0;
  const boss =
    args.boss !== undefined
      ? args.boss
      : rush && rushIndex >= 0
        ? (DISTRICT_DEMAND[district].bosses[rushIndex] ?? null)
        : null;
  if (boss !== null && !rush) throw new RangeError(`boss ${boss} needs a rush round`);
  if (boss !== null && !SUPPORTED_BOSSES.includes(boss)) {
    throw new RangeError(
      `boss "${boss}" is not implemented yet (supported: ${SUPPORTED_BOSSES.join(', ')})`,
    );
  }
  const map = pick(maps(district), (seed ^ MAP_SALT) >>> 0);
  const demandProfile = generateDemand({ map, district, round, rush, boss, seed });
  const quota = roundQuota(district, round, rush);
  return {
    map,
    demandProfile,
    heatStrip: heatStrip(map, demandProfile),
    quota,
    districtRules: { district, round, rush, boss, quota, pSlowPermille: 0 },
  };
}
