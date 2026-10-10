import { createPrng, emptyMap, nextInt, type DemandEvent, type VehicleType } from '@rushwarden/sim';
import type { RunEnv } from '@rushwarden/app';
import { quotaFor } from '@rushwarden/app';

/**
 * STAND-IN map and demand until content's District 1 maps (#19, P1-CON-03) and demand generator
 * (P1-CON-04) land: the sim's plus-shaped test map, and demand drawn from the round seed with the
 * §5 District 1 mix (70% car, 15% bus, 10% truck, 5% bike), about 1.5× the quota in vehicles,
 * sorted by (tick, edge) as `Sim.init` requires. Reports made with it say so.
 */
export const standinEnv: RunEnv = {
  setupRound({ district, round, rush, seed }) {
    const map = emptyMap();
    const prng = createPrng(seed);
    const count = quotaFor(district, round, rush) + (quotaFor(district, round, rush) >> 1);
    const edges = map.edges.length;
    const demandProfile: DemandEvent[] = [];
    for (let i = 0; i < count; i++) {
      const roll = nextInt(prng, 100);
      const vehicleType: VehicleType = roll < 70 ? 0 : roll < 85 ? 2 : roll < 95 ? 3 : 5;
      const edge = nextInt(prng, edges);
      const destinationEdge = (edge + 1 + nextInt(prng, edges - 1)) % edges;
      demandProfile.push({ tick: nextInt(prng, 300), edge, vehicleType, destinationEdge });
    }
    demandProfile.sort((a, b) => a.tick - b.tick || a.edge - b.edge);
    return { map, demandProfile };
  },
};
