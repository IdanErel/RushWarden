import { createPrng, emptyMap, nextInt, type DemandEvent, type VehicleType } from '@rushwarden/sim';
import type { RunEnv } from '@rushwarden/app';
import { roundQuota } from '@rushwarden/content';

/**
 * Test-only environment: the sim's plus-shaped test map, and demand drawn from the round seed with
 * the §5 District 1 mix (70% car, 15% bus, 10% truck, 5% bike), about 1.5× the quota in vehicles,
 * sorted by (tick, edge) as `Sim.init` requires. Small and fast, so the scored-report fixtures do
 * not depend on content's maps; real reports use `CONTENT_ENV`.
 */
export const standinEnv: RunEnv = {
  setupRound({ district, round, rush, seed }) {
    const map = emptyMap();
    const prng = createPrng(seed);
    const quota = roundQuota(district, round, rush);
    const count = quota + (quota >> 1);
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
