/** One row of the GDD section 3 vehicle table. */
export interface VehicleSpec {
  /** Cells occupied, head first. */
  readonly length: number;
  /** Max speed in cells per tick. */
  readonly vmax: number;
  /** Throughput added on exit. */
  readonly score: number;
}

/**
 * GDD section 3 vehicle table, indexed by `VehicleType`:
 * Car 1/3/1, Taxi 1/3/1, Bus 2/2/3, Truck 3/2/2, Emergency 1/4/5, Bike 1/2/1 (length/vmax/score).
 */
export const VEHICLE_SPECS: readonly VehicleSpec[] = [
  { length: 1, vmax: 3, score: 1 }, // Car: standard
  { length: 1, vmax: 3, score: 1 }, // Taxi: re-routes at each intersection
  { length: 2, vmax: 2, score: 3 }, // Bus: stops BUS_DWELL_TICKS at bus-stop tiles
  { length: 3, vmax: 2, score: 2 }, // Truck
  { length: 1, vmax: 4, score: 5 }, // Emergency
  { length: 1, vmax: 2, score: 1 }, // Bike: BIKE_SHARED_VMAX without a bike lane
];

/** Ticks a bus stands at a bus-stop tile (GDD section 3: "Stops 4 ticks at bus-stop tiles"). */
export const BUS_DWELL_TICKS = 4;

/** Bike speed when sharing the lane (GDD section 3: "else shares the lane at speed 1"). */
export const BIKE_SHARED_VMAX = 1;

/** Longest vehicle, in cells. */
export const MAX_VEHICLE_LENGTH = 3;

/** Number of vehicle types. */
export const VEHICLE_TYPE_COUNT = 6;
