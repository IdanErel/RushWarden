/**
 * Public types of the simulation (GDD sections 3, 4 and 6).
 *
 * Every number in these types is an integer. Percentages are whole percent (40 = 40%),
 * probabilities are per-mille (100 = 10%), times are ticks (20 ticks per sim second).
 * Changing anything exported here is an interface change: announce it first (GDD section 13,
 * coordination rule 6) and get Lead approval.
 */

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Sim ticks per simulated second. */
export const TICKS_PER_SECOND = 20;
/** Ticks in one Go phase (15 s). */
export const ROUND_TICKS = 300;
/** Consecutive ticks with zero total speed that end the round as gridlock (3 s). */
export const GRIDLOCK_TICKS = 60;
/** Map width in tiles (portrait). */
export const GRID_WIDTH = 7;
/** Map height in tiles (portrait). */
export const GRID_HEIGHT = 9;
/** Cells per lane per road tile. */
export const CELLS_PER_TILE = 4;

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

/** Vehicle types, numbered for compact snapshots. Values are stable; never renumber. */
export const VehicleType = {
  Car: 0,
  Taxi: 1,
  Bus: 2,
  Truck: 3,
  Emergency: 4,
  Bike: 5,
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];

// ---------------------------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------------------------

/** A tile coordinate; x in [0, GRID_WIDTH), y in [0, GRID_HEIGHT), origin top-left. */
export interface TileRef {
  readonly x: number;
  readonly y: number;
}

export type Side = 'n' | 'e' | 's' | 'w';

export type MapTile =
  | { readonly kind: 'block' }
  | {
      readonly kind: 'road';
      /** Lanes per direction, 1 or 2. */
      readonly lanes: 1 | 2;
      readonly busStop?: boolean;
      /** Part of the outer ring road (District 3, Ring Road card). */
      readonly ring?: boolean;
    };

/** A spawner/sink on the map boundary. Every edge both spawns and absorbs traffic. */
export interface MapEdge {
  readonly id: number;
  readonly tile: TileRef;
  readonly side: Side;
}

/**
 * A fully resolved map. Content owns the template bank and variants; the sim receives the
 * resolved grid so it never loads data (see ADR-001).
 */
export interface GridMap {
  readonly id: string;
  /** Row-major, GRID_WIDTH * GRID_HEIGHT entries. */
  readonly tiles: readonly MapTile[];
  readonly edges: readonly MapEdge[];
}

export type ControllerKind = 'uncontrolled' | 'signal' | 'roundabout' | 'stop-all' | 'priority';

// ---------------------------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------------------------

/** One scheduled spawn. Generated from the seed before Go and shown to the player. */
export interface DemandEvent {
  /** Tick in [0, ROUND_TICKS). */
  readonly tick: number;
  readonly edge: number;
  readonly vehicleType: VehicleType;
  readonly destinationEdge: number;
}

/** The round's demand, sorted by (tick, edge). */
export type DemandProfile = readonly DemandEvent[];

// ---------------------------------------------------------------------------------------------
// Cards: targets and effect primitives (GDD section 4)
// ---------------------------------------------------------------------------------------------

export type Target =
  | { readonly kind: 'intersection'; readonly tile: TileRef }
  | { readonly kind: 'segment'; readonly from: TileRef; readonly to: TileRef }
  | { readonly kind: 'edge'; readonly edge: number }
  | { readonly kind: 'district' };

/**
 * The effect primitives the sim understands. Cards are data built from these; a card that needs
 * a new primitive gets it added here with tests first. Parameter shapes are owned by the Sim
 * Engineer and will be refined in Phase 1 through the interface-change process.
 */
export type Effect =
  | {
      readonly kind: 'setController';
      readonly controller: ControllerKind;
      readonly direction?: Side;
      readonly capacity?: number;
    }
  | {
      readonly kind: 'setSignalPhase';
      readonly mode: 'adaptive' | 'wave' | 'district-cycle';
      readonly switchTicks?: number;
    }
  | {
      readonly kind: 'setLaneCount';
      readonly lanes: 1 | 2 | 3 | 4;
      readonly scope?: 'segment' | 'ring';
    }
  | {
      readonly kind: 'setSpeedLimit';
      readonly delta: number;
      readonly types?: readonly VehicleType[];
    }
  | { readonly kind: 'banType'; readonly vehicleType: VehicleType }
  | {
      readonly kind: 'preferType';
      readonly vehicleType: VehicleType;
      readonly alsoTypes?: readonly VehicleType[];
    }
  | { readonly kind: 'addBusStop'; readonly dwellTicks: number }
  | { readonly kind: 'addBikeLane'; readonly bikeVmax: number; readonly carVmaxDelta: number }
  | { readonly kind: 'setOneWay'; readonly direction: Side; readonly doubleLanes: boolean }
  | {
      readonly kind: 'reroute';
      readonly percent: number;
      readonly toEdge?: number;
      readonly vehicleTypes?: readonly VehicleType[];
    }
  | { readonly kind: 'spawnModifier'; readonly vehicleType: VehicleType; readonly percent: number }
  | {
      readonly kind: 'scoreModifier';
      readonly vehicleType?: VehicleType;
      readonly delta: number;
      readonly condition?: 'above-quota' | 'same-tick-window' | 'on-arrival';
    }
  | { readonly kind: 'setPSlow'; readonly deltaPermille: number }
  | { readonly kind: 'yieldRule'; readonly fasterTicks: number }
  | { readonly kind: 'drawModifier'; readonly delta: number }
  | { readonly kind: 'energyModifier'; readonly delta: number; readonly perRound?: boolean }
  | { readonly kind: 'fundsModifier'; readonly delta: number; readonly per?: number };

export type EffectKind = Effect['kind'];

/** A card placed this round, with its effects already resolved from content data. */
export interface Placement {
  readonly cardId: string;
  readonly tier: 1 | 2;
  readonly target: Target;
  readonly effects: readonly Effect[];
  /** Order of play within the round; later placements win controller conflicts. */
  readonly order: number;
}

/** Run-scoped state the sim needs: effects with duration `run` from earlier rounds. */
export interface CardState {
  readonly runEffects: readonly Placement[];
}

// ---------------------------------------------------------------------------------------------
// District rules
// ---------------------------------------------------------------------------------------------

export type BossCondition =
  | 'market-day'
  | 'parade'
  | 'festival'
  | 'stadium-exit'
  | 'signal-outage'
  | 'blackout'
  | 'convoy'
  | 'marathon'
  | 'gridlock-drill';

export interface DistrictRules {
  readonly district: 1 | 2 | 3;
  /** Round number, 1-based. */
  readonly round: number;
  readonly rush: boolean;
  readonly boss: BossCondition | null;
  /** Throughput needed to pass; computed by content from the GDD quota formula. */
  readonly quota: number;
  /** Baseline NaSch slowdown probability in per-mille; cards add to it. */
  readonly pSlowPermille: number;
}

// ---------------------------------------------------------------------------------------------
// Round input and result
// ---------------------------------------------------------------------------------------------

/**
 * Everything one round depends on. `Sim.simulate(input)` is a pure function of this value.
 * Fields mirror GDD section 6; `map` is added so the sim never loads content (ADR-001).
 */
export interface RoundInput {
  /** uint32 seed owned by this round. */
  readonly seed: number;
  readonly mapId: string;
  readonly map: GridMap;
  readonly demandProfile: DemandProfile;
  readonly placements: readonly Placement[];
  readonly cardState: CardState;
  readonly districtRules: DistrictRules;
  /** When true, `RoundResult.frames` holds one snapshot per tick for replay. */
  readonly recordFrames?: boolean;
}

export interface RoundResult {
  /** Score: sum of score values of vehicles that exited, plus card score modifiers. */
  readonly throughput: number;
  readonly spawned: number;
  /** Vehicles that reached a sink. */
  readonly exited: number;
  /** Ticks actually simulated (less than ROUND_TICKS on gridlock). */
  readonly ticks: number;
  readonly gridlocked: boolean;
  /** Funds earned by in-round effects (Toll Booth, Congestion Charge). */
  readonly fundsDelta: number;
  /** 64-bit hash of the final state as 16 hex characters; the determinism fingerprint. */
  readonly finalHash: string;
  /** Per-tick snapshots (see `Sim.snapshot`), present only when `recordFrames` was set. */
  readonly frames?: readonly Uint16Array[];
}

/**
 * Opaque per-round simulation state. Treat it as owned by whoever holds it last:
 * `Sim.step(state)` may update in place and returns the state to use next (ADR-002).
 */
export interface SimState {
  readonly tick: number;
  readonly done: boolean;
}

/** Fields per vehicle in a snapshot: id, lane, cell, speed, type. */
export const SNAPSHOT_STRIDE = 5;
/** Header words in a snapshot: tick, vehicle count. */
export const SNAPSHOT_HEADER = 2;
