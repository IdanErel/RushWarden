import {
  GRID_HEIGHT,
  GRID_WIDTH,
  type GridMap,
  type MapTile,
  placementError,
  type Target,
} from '@rushwarden/sim';
import { describe, expect, it } from 'vitest';
import {
  cardText,
  getCard,
  loadCards,
  needsSecondaryTarget,
  PHASE1_BLOCKED,
  PHASE1_CARD_IDS,
  type TargetKind,
  toPlacement,
} from '../src/index.js';

/**
 * A straight road down column 3, with an edge at each end and a bus stop at (3,3), plus a
 * one-tile road stub on each side at y = 4, so (3,4) is an intersection. The stubs are dead ends
 * without edges, so `buildWorld` (and `Sim.init`) would reject this map; it is only for
 * `placementError`, which checks targets against tiles. Give the stubs edges before simulating it.
 */
function testMap(): GridMap {
  const tiles: MapTile[] = [];
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      // A north-south road with a stub each side at y = 4, so (3, 4) is an intersection (3+ road
      // neighbours), which the sim's placement check requires of intersection targets.
      const road = x === 3 || (y === 4 && (x === 2 || x === 4));
      tiles.push(
        road
          ? { kind: 'road', lanes: 1, ...(x === 3 && y === 3 ? { busStop: true } : {}) }
          : { kind: 'block' },
      );
    }
  }
  return {
    id: 'phase1-cards',
    tiles,
    edges: [
      { id: 0, tile: { x: 3, y: 0 }, side: 'n' },
      { id: 1, tile: { x: 3, y: GRID_HEIGHT - 1 }, side: 's' },
    ],
  };
}

const TARGETS: Record<TargetKind, Target> = {
  intersection: { kind: 'intersection', tile: { x: 3, y: 4 } },
  segment: { kind: 'segment', from: { x: 3, y: 3 }, to: { x: 3, y: 5 } },
  edge: { kind: 'edge', edge: 0 },
  district: { kind: 'district' },
};

describe('Phase 1 card set (docs/tasks/phase-1.md)', () => {
  it('lists 20 cards, 4 per archetype, all bundled', () => {
    expect(new Set(PHASE1_CARD_IDS).size).toBe(20);
    expect(PHASE1_BLOCKED).toEqual({});
    const bundled = PHASE1_CARD_IDS.filter((id) => PHASE1_BLOCKED[id] === undefined).map(getCard);
    for (const card of bundled) expect(card.tags).toHaveLength(1);
  });

  it('every Phase 1 card is either bundled or blocked with a reason, never both', () => {
    const bundled = new Set(loadCards().map((c) => c.id));
    for (const id of PHASE1_CARD_IDS) {
      const blocked = PHASE1_BLOCKED[id] !== undefined;
      expect(bundled.has(id) !== blocked, id).toBe(true);
    }
    for (const id of bundled) expect(PHASE1_CARD_IDS as readonly string[]).toContain(id);
  });

  // GDD §4 list items, with the generated text at both tiers. Text is generated, not stored:
  // this table is the evidence that data, text and the brief agree.
  const GDD: [string, string, number, string, string, string, string][] = [
    [
      'smart-signal',
      'intersection',
      1,
      'common',
      'FLOW',
      'Becomes a signal. Signal is adaptive: the longest queue gets green.',
      'Becomes a signal. Signal is adaptive: the longest queue gets green. Phases switch 2 ticks faster (4 ticks).',
    ],
    [
      'one-way',
      'segment',
      1,
      'common',
      'FLOW',
      'This segment becomes one-way in the direction you place it, with its lanes doubled that way.',
      'This segment becomes one-way in the direction you place it, with its lanes doubled that way.',
    ],
    [
      'turn-lane',
      'intersection',
      1,
      'common',
      'FLOW',
      'Left turns get their own lane and stop blocking through traffic.',
      'Left and right turns get their own lanes and stop blocking through traffic.',
    ],
    [
      'speed-limit-up',
      'segment',
      1,
      'common',
      'FLOW',
      '+1 top speed on this segment for all vehicles except trucks.',
      '+1 top speed on this segment for all vehicles.',
    ],
    [
      'bus-priority',
      'intersection',
      1,
      'common',
      'MASS',
      'Buses get green on approach to this intersection.',
      'Buses and taxis get green on approach to this intersection.',
    ],
    [
      'express-stop',
      'segment',
      1,
      'common',
      'MASS',
      'Buses dwell 2 ticks at the bus stop on this segment.',
      'Buses dwell 1 tick at the bus stop on this segment.',
    ],
    [
      'bus-lane',
      'segment',
      2,
      'uncommon',
      'MASS',
      'One lane of this segment is reserved for buses and bikes.',
      'One lane of this segment is reserved for buses and bikes. +1 top speed, up to 2, on this segment for bikes.',
    ],
    [
      'fare-holiday',
      'district',
      1,
      'common',
      'MASS',
      '+40% bus spawns. +40% bike spawns. \u221220% car spawns.',
      '+60% bus spawns. +60% bike spawns. \u221230% car spawns.',
    ],
    [
      'detour',
      'edge',
      1,
      'common',
      'TOLL',
      '50% of spawns from this edge move to the next edge clockwise.',
      '50% of spawns from this edge move to an edge you choose.',
    ],
    [
      'toll-booth',
      'segment',
      1,
      'common',
      'TOLL',
      'Top speed at most 1 on the first 2 cells of this segment for all vehicles. +1 funds per 4 vehicles through this segment.',
      '+1 funds per 4 vehicles through this segment.',
    ],
    [
      'staggered-hours',
      'district',
      2,
      'uncommon',
      'TOLL',
      'Rush hour spreads out: peak demand 30% lower, spread over the round.',
      'Rush hour spreads out: peak demand 40% lower, spread over the round.',
    ],
    [
      'delivery-window',
      'district',
      1,
      'common',
      'TOLL',
      'Trucks spawn only in the first 5 seconds.',
      'Trucks spawn only in the first 5 seconds. Trucks score +1.',
    ],
    [
      'roundabout',
      'intersection',
      1,
      'common',
      'CHAOS',
      'Becomes a roundabout holding up to 4 vehicles.',
      'Becomes a roundabout holding up to 6 vehicles.',
    ],
    [
      'yield-culture',
      'district',
      2,
      'uncommon',
      'CHAOS',
      'Uncontrolled intersections resolve 1 tick faster.',
      'Uncontrolled intersections resolve 2 ticks faster.',
    ],
    [
      'no-heavy',
      'segment',
      1,
      'common',
      'CHAOS',
      'Trucks are banned from this segment and route around it.',
      'Trucks are banned from every road in the district of the same class (local or arterial) as this segment and route around them.',
    ],
    [
      'remove-signal',
      'intersection',
      1,
      'common',
      'CHAOS',
      'Becomes an uncontrolled junction. +1 energy this round if it replaced a signal.',
      'Becomes an uncontrolled junction. +2 energy this round if it replaced a signal.',
    ],
    [
      'overtime',
      'district',
      1,
      'common',
      'TEMPO',
      '+1 energy next round.',
      '+2 energy next round.',
    ],
    [
      'second-shift',
      'district',
      2,
      'uncommon',
      'TEMPO',
      'Draw 2 extra cards next round.',
      'Draw 2 extra cards next round. +1 energy next round.',
    ],
    [
      'recount',
      'district',
      1,
      'common',
      'TEMPO',
      'Redraw your hand.',
      'Keep 1 card, then redraw the rest of your hand.',
    ],
    [
      'pilot-program',
      'district',
      1,
      'common',
      'TEMPO',
      'The next card you play this round costs 0.',
      'The next 2 cards you play this round cost 0.',
    ],
  ];
  it.each(GDD)(
    '%s matches GDD §4 (%s, cost %i, %s, %s)',
    (id, target, cost, rarity, tag, t1, t2) => {
      const card = getCard(id);
      expect(card).toMatchObject({ target, cost, rarity, tags: [tag], duration: 'round' });
      expect(cardText(card, 1)).toBe(t1);
      expect(cardText(card, 2)).toBe(t2);
    },
  );

  it('covers every bundled card in the GDD table', () => {
    expect(
      loadCards()
        .map((c) => c.id)
        .sort(),
    ).toEqual(GDD.map((r) => r[0]).sort());
  });

  it('every bundled card, at both tiers, passes the sim placement check (ADR-014)', () => {
    const map = testMap();
    for (const card of loadCards()) {
      for (const tier of [1, 2] as const) {
        const secondary = needsSecondaryTarget(card, tier)
          ? ({ kind: 'edge', edge: 1 } as const)
          : undefined;
        const placement = toPlacement(card, tier, TARGETS[card.target], 0, secondary);
        expect(placementError(map, placement), `${card.id} tier ${tier}`).toBeNull();
      }
    }
  });
});
