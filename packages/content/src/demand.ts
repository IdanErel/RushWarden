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
import { paradeCandidates, pickParadeSegment, type SegmentId } from './parade.js';

/** Seconds in one Go phase (15). */
export const ROUND_SECONDS = idiv(ROUND_TICKS, TICKS_PER_SECOND);

/**
 * Base quota per district. GDD §2 starts at `[26, 34, 42]` and leaves the values to the balance
 * sim. District 1 is tuned by P1-CON-05 to about 90% of round 1's demand score (ADR-021 item 3);
 * Districts 2 and 3 keep the GDD values until they have maps and a report.
 */
export const BASE_QUOTA: { readonly [D in District]: number } = { 1: 83, 2: 34, 3: 42 };
/** GDD §2: quota grows 11% per round (`1 + 0.11*(r-1)`), in per-mille. */
export const ROUND_GROWTH_PERMILLE = 110;
/** GDD §2: rush rounds have 1.6× demand and quota, in per-mille. */
export const RUSH_PERMILLE = 1600;
/** GDD §2: rounds 4, 8 and 12 are rush rounds. */
export const RUSH_ROUNDS: readonly number[] = [4, 8, 12];

/** Per-mille shares of each vehicle type in a district's demand (GDD §5 "Demand mix"). */
export type DemandMix = Readonly<Partial<Record<keyof typeof VehicleType, number>>>;

export interface DistrictDemand {
  /** Vehicles spawned in round 1 before growth and rush (tuned by P1-CON-05). */
  readonly baseVehicles: number;
  readonly mix: DemandMix;
  /** Festival boss (GDD §5 "all demand +60%, emergency vehicles appear"): volume and mix. */
  readonly festival: { readonly demandPermille: number; readonly mix: DemandMix };
  /** GDD §5 rush-round bosses for rounds 4, 8 and 12. */
  readonly bosses: readonly [BossCondition, BossCondition, BossCondition];
}

/**
 * Demand per district. Only District 1 has maps in Phase 1 (ADR-007).
 *
 * Tuned by P1-CON-05 from the balance report (ADR-021 item 3). With D1's mix the mean score per
 * vehicle is 1.4 (bus 3, truck 2, car and bike 1), so round 1's 66 vehicles score about 92 when
 * nothing jams, against a quota of 83 (the toy scales both by the map's factor, ADR-032). A District 1
 * map carries nearly all of its demand until it jams, so the quota sits just under a clean round:
 * a round that jams or gridlocks fails. Demand grows with the quota (11% a round) and the map does
 * not, so jams get likelier each round.
 */
export const DISTRICT_DEMAND: { readonly 1: DistrictDemand } = {
  1: {
    baseVehicles: 66,
    mix: { Car: 700, Bus: 150, Truck: 100, Bike: 50 },
    // +60% on top of the rush round's 1.6×; emergency vehicles take 5% from cars (D3's share).
    festival: {
      demandPermille: 1600,
      mix: { Car: 650, Bus: 150, Truck: 100, Bike: 50, Emergency: 50 },
    },
    bosses: ['market-day', 'parade', 'festival'],
  },
};

/**
 * Relative spawn weight per second of the round: a sharp rush-hour peak in seconds 1–5, then a
 * trickle. The peak is what jams a map, so cards that clear junctions decide the round; with a
 * flat curve the maps absorb about a third more vehicles before they jam (P1-CON-05).
 */
export const SECOND_WEIGHTS: readonly number[] = [10, 16, 18, 14, 10, 6, 3, 1, 1, 1, 1, 1, 1, 1, 1];

/** Each edge gets a seeded weight in [1, 5] per round, so some edges run hot (§2 heat-strip). */
export const EDGE_WEIGHT_MAX = 5;

/** GDD §5 Market Day: "+2 truck spawns/s", on top of the rush round's demand. */
export const MARKET_DAY_TRUCKS_PER_SECOND = 2;

/** Bosses `setupRound` can produce: District 1's three (GDD §5). */
export const SUPPORTED_BOSSES: readonly BossCondition[] = ['market-day', 'parade', 'festival'];

/**
 * Salts XORed into the round seed so the map pick, the demand, the Parade closure and the sim's
 * own PRNG (which uses the round seed as is) never share a stream (ADR-021).
 */
export const SEED_SALTS = { map: 0x6d617073, demand: 0x64656d64, parade: 0x70617264 } as const;

/**
 * ADR-032: each District 1 template's demand factor, in per-mille, for the itch toy only. In a
 * round set up with `templateDemand`, it scales both the round's vehicles and its quota, so every
 * template sits near its jam point: a map that carries more before it jams gets more traffic and
 * a higher quota, a map that jams early gets less of both. Full runs don't use it (§11 gates read
 * the full run). Calibrated by CON-06 from each template's no-card 50% pass point at rounds 4, 7,
 * 8 and 12 (geometric mean, normalised over the bank), times 0.905 for the toy's level.
 */
export const TEMPLATE_DEMAND_PERMILLE: Readonly<Record<string, number>> = {
  'd1-01': 760,
  'd1-02': 530,
  'd1-03': 1640,
  'd1-04': 1190,
  'd1-05': 690,
  'd1-06': 1710,
  'd1-07': 580,
  'd1-08': 1420,
  'd1-09': 640,
  'd1-10': 620,
  'd1-11': 540,
  'd1-12': 1810,
};

/**
 * ADR-032: a round with the template factor also lifts its quota by this much (83 to about 88,
 * about 95% of a clean round's score), so a flowing round passes and a jammed one fails.
 */
export const TEMPLATE_QUOTA_LEVEL_PERMILLE = 1060;

/**
 * The demand factor of a map (ADR-032), by its template: a variant id (`d1-03-mx`) uses its
 * template's (`d1-03`). 1000 for a map with no factor, and when no map is given.
 */
export function templateDemandPermille(mapId?: string): number {
  if (mapId === undefined) return 1000;
  const template = /^d\d+-\d+/.exec(mapId)?.[0] ?? mapId;
  return TEMPLATE_DEMAND_PERMILLE[template] ?? 1000;
}

/**
 * `quota = base[d] * (1 + 0.11*(r-1)) * rushMult` (GDD §2) in per-mille integers, rounded half
 * up (ADR-018 item 5), with the tuned `BASE_QUOTA`. The single quota source (ADR-021 item 2).
 * `quotaPermille` is a mayor modifier (1000 = none). `mapId` is given only for a round with the
 * template factor (the toy, ADR-032): the quota is then also multiplied by the map's factor and
 * `TEMPLATE_QUOTA_LEVEL_PERMILLE`.
 */
export function roundQuota(
  district: District,
  round: number,
  rush: boolean,
  quotaPermille = 1000,
  mapId?: string,
): number {
  // The factor and the level as one per-mille, rounded half up, so the product stays exact.
  const mapPermille =
    mapId === undefined
      ? 1000
      : idiv(templateDemandPermille(mapId) * TEMPLATE_QUOTA_LEVEL_PERMILLE + 500, 1000);
  const num =
    BASE_QUOTA[district] *
    (1000 + ROUND_GROWTH_PERMILLE * (round - 1)) *
    (rush ? RUSH_PERMILLE : 1000) *
    quotaPermille *
    mapPermille;
  const den = 1_000_000_000_000;
  return idiv(num + idiv(den, 2), den);
}

/**
 * ADR-030: the itch toy's 5 rounds sample District 1's 12-round curve instead of replaying rounds
 * 1–5. Toy round `i` plays D1 round `TOY_ROUNDS[i - 1]`: that round's quota, demand, rush and
 * boss. Tuned by P1-CON-05 against the toy targets in ADR-030, and by CON-06 (ADR-032) to play
 * round 11 third instead of a second Festival.
 */
export const TOY_ROUNDS: readonly number[] = [4, 8, 11, 8, 12];

/**
 * The toy's rush rounds as run-controller data (`RunConfig.rushRounds`): each toy round whose D1
 * round is a rush round, with that round's §5 boss.
 */
export function toyRushRounds(
  rounds: readonly number[] = TOY_ROUNDS,
): { readonly round: number; readonly boss: BossCondition }[] {
  const out: { round: number; boss: BossCondition }[] = [];
  rounds.forEach((d1Round, i) => {
    const k = RUSH_ROUNDS.indexOf(d1Round);
    const boss = DISTRICT_DEMAND[1].bosses[k];
    if (k >= 0 && boss) out.push({ round: i + 1, boss });
  });
  return out;
}

/**
 * Vehicles in a round's demand before Market Day trucks (which come on top), rounded half up:
 * `base * (1 + 0.11*(r-1)) * rush * festival`, times the map's factor when `mapId` is given
 * (the toy's template factor, ADR-032).
 */
export function roundVehicles(
  district: 1,
  round: number,
  rush: boolean,
  boss: BossCondition | null = null,
  mapId?: string,
): number {
  const d = DISTRICT_DEMAND[district];
  const num =
    d.baseVehicles *
    (1000 + ROUND_GROWTH_PERMILLE * (round - 1)) *
    (rush ? RUSH_PERMILLE : 1000) *
    (boss === 'festival' ? d.festival.demandPermille : 1000) *
    templateDemandPermille(mapId);
  const den = 1_000_000_000_000;
  return idiv(num + idiv(den, 2), den);
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
    // Destination: uniform over the other edges (every pair is routable, P1-CON-03).
    let d = nextInt(this.prng, this.edges.length - 1);
    if (d >= e) d += 1;
    const destinationEdge = this.edges[d] ?? 0;
    const start = second * TICKS_PER_SECOND + nextInt(this.prng, TICKS_PER_SECOND);
    // An edge with a spawn on every tick passes the vehicle on to the next edge that is not its
    // destination (ADR-032: a busy 4-edge map's Festival can fill an edge).
    for (let j = 0; j < this.edges.length; j++) {
      const i = (e + j) % this.edges.length;
      if (i === d) continue;
      const edge = this.edges[i] ?? 0;
      // Probe forward from the drawn tick, wrapping over the whole round, for a free (tick, edge).
      for (let k = 0; k < ROUND_TICKS; k++) {
        const tick = (start + k) % ROUND_TICKS;
        const key = tick * 1024 + edge;
        if (this.used.has(key)) continue;
        this.used.add(key);
        this.events.push({ tick, edge, vehicleType, destinationEdge });
        return;
      }
    }
    throw new RangeError('no edge has a free spawn tick');
  }
}

export interface DemandArgs {
  readonly map: GridMap;
  readonly district: 1;
  readonly round: number;
  readonly rush: boolean;
  readonly boss: BossCondition | null;
  readonly seed: number;
  /** ADR-032: scale the volume by the map's template factor (the toy). Default false. */
  readonly templateDemand?: boolean;
}

/**
 * The round's demand profile, sorted by (tick, edge), unique per (tick, edge), every destination
 * a different edge. Deterministic in its arguments.
 */
export function generateDemand(a: DemandArgs): DemandProfile {
  if (a.map.edges.length < 2) throw new RangeError(`map ${a.map.id} needs at least 2 edges`);
  const prng = createPrng((a.seed ^ SEED_SALTS.demand) >>> 0);
  const edges = a.map.edges.map((e) => e.id);
  const edgeWeights = edges.map(() => 1 + nextInt(prng, EDGE_WEIGHT_MAX));
  const spawner = new Spawner(prng, edges, edgeWeights);

  const d = DISTRICT_DEMAND[a.district];
  const types: VehicleType[] = [];
  for (const [type, count] of mixCounts(
    roundVehicles(a.district, a.round, a.rush, a.boss, a.templateDemand ? a.map.id : undefined),
    a.boss === 'festival' ? d.festival.mix : d.mix,
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
  /**
   * ADR-032: scale demand and quota by the map's template factor. The toy sets it; full runs
   * don't. Default false.
   */
  readonly templateDemand?: boolean;
}

export interface RoundSetup {
  readonly map: GridMap;
  readonly demandProfile: DemandProfile;
  readonly heatStrip: HeatStrip;
  /** GDD §2 quota with no mayor modifier (with the template factor when asked, ADR-032). */
  readonly quota: number;
  readonly districtRules: DistrictRules;
  /**
   * Segments closed this round: one on a Parade round, else none. Pass it on as
   * `RoundInput.closedSegments` (ADR-022).
   */
  readonly closedSegments: readonly SegmentId[];
}

/**
 * `setupRound` with the map bank and picker passed in (the index binds the bundled ones).
 * Sets up one round from its seed: map, demand, heat-strip, quota, district rules and closures.
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
  // A Parade needs a segment it can close without cutting off an edge; tree-shaped maps have
  // none, so Parade rounds pick from the maps that do (ADR-021).
  const bank = maps(district);
  const pool = boss === 'parade' ? bank.filter((m) => paradeCandidates(m).length > 0) : bank;
  const map = pick(pool, (seed ^ SEED_SALTS.map) >>> 0);
  const templateDemand = args.templateDemand ?? false;
  const demandProfile = generateDemand({ map, district, round, rush, boss, seed, templateDemand });
  const quota = roundQuota(district, round, rush, 1000, templateDemand ? map.id : undefined);
  return {
    map,
    demandProfile,
    heatStrip: heatStrip(map, demandProfile),
    quota,
    districtRules: { district, round, rush, boss, quota, pSlowPermille: 0 },
    closedSegments:
      boss === 'parade' ? [pickParadeSegment(map, (seed ^ SEED_SALTS.parade) >>> 0)] : [],
  };
}
