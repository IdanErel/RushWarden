/**
 * The card JSON schema (GDD section 4, "Card anatomy"). This object is the single source: the
 * validator interprets it and `schema/card.schema.json` is written from it for editors.
 *
 * Effects mirror the `Effect` union in `@rushwarden/sim` field for field; the only difference is
 * that vehicle types are written as names ("bus") in JSON and converted to `VehicleType` numbers
 * by the loader (ADR-009). The `EffectSchemas` type below makes a property added to or removed
 * from an `Effect` variant a compile error here until the schema is updated.
 */
import type { Effect, EffectKind } from '@rushwarden/sim';
import type { JsonSchema } from './json-schema.js';

export const TAGS = ['FLOW', 'MASS', 'TOLL', 'CHAOS', 'TEMPO'] as const;
export const TARGET_KINDS = ['intersection', 'segment', 'edge', 'district'] as const;
export const DURATIONS = ['round', 'run'] as const;
export const RARITIES = ['common', 'uncommon', 'rare'] as const;
/** Vehicle names in JSON, indexed by `VehicleType` number. */
export const VEHICLE_NAMES = ['car', 'taxi', 'bus', 'truck', 'emergency', 'bike'] as const;
export const SIDES = ['n', 'e', 's', 'w'] as const;
export const ROAD_CLASSES = ['local', 'arterial'] as const;
export const CONTROLLERS = [
  'uncontrolled',
  'signal',
  'roundabout',
  'stop-all',
  'priority',
] as const;

/** Max length of the one free-form field (GDD section 4). */
export const FLAVOR_MAX = 60;

const vehicle: JsonSchema = { $ref: '#/$defs/vehicleType' };
const vehicles: JsonSchema = {
  type: 'array',
  items: vehicle,
  minItems: 1,
  maxItems: VEHICLE_NAMES.length,
  uniqueItems: true,
};
const side: JsonSchema = { $ref: '#/$defs/side' };
const int = (minimum: number, maximum: number, description?: string): JsonSchema => ({
  type: 'integer',
  minimum,
  maximum,
  ...(description === undefined ? {} : { description }),
});
const nonZero = (minimum: number, maximum: number, description?: string): JsonSchema => ({
  ...int(minimum, maximum, description),
  not: { const: 0 },
});

type EffectOf<K extends EffectKind> = Extract<Effect, { kind: K }>;
type RequiredKeys<T> = { [P in keyof T]-?: object extends Pick<T, P> ? never : P }[keyof T];
interface EffectSchema<K extends EffectKind> extends JsonSchema {
  readonly type: 'object';
  readonly properties: { readonly [P in keyof EffectOf<K>]-?: JsonSchema };
  readonly required: readonly (RequiredKeys<EffectOf<K>> & string)[];
  readonly additionalProperties: false;
}
type EffectSchemas = { readonly [K in EffectKind]: EffectSchema<K> };

const kind = <K extends EffectKind>(k: K): JsonSchema => ({ const: k });

/** One schema per effect primitive, keyed by `kind`. */
export const EFFECT_SCHEMAS: EffectSchemas = {
  setController: {
    type: 'object',
    description: 'Replace the intersection controller.',
    properties: {
      kind: kind('setController'),
      controller: { type: 'string', enum: CONTROLLERS },
      direction: { ...side, description: 'Priority approach; only with controller "priority".' },
      capacity: int(1, 16, 'Roundabout occupancy; only with controller "roundabout".'),
    },
    required: ['kind', 'controller'],
    additionalProperties: false,
  },
  setSignalPhase: {
    type: 'object',
    properties: {
      kind: kind('setSignalPhase'),
      mode: { type: 'string', enum: ['adaptive', 'wave', 'district-cycle'] },
      switchTicks: int(1, 300, 'Absolute ticks a phase switch takes; overrides the default.'),
      switchTicksDelta: nonZero(-20, 20, 'Change to DEFAULT_SWITCH_TICKS (-2 = 2 ticks faster).'),
    },
    required: ['kind', 'mode'],
    additionalProperties: false,
  },
  setLaneCount: {
    type: 'object',
    properties: {
      kind: kind('setLaneCount'),
      lanes: int(1, 4, 'Lanes per direction.'),
      scope: { type: 'string', enum: ['segment', 'ring'] },
    },
    required: ['kind', 'lanes'],
    additionalProperties: false,
  },
  setSpeedLimit: {
    type: 'object',
    properties: {
      kind: kind('setSpeedLimit'),
      delta: int(-4, 4, 'Change to vmax in cells per tick; 0 only with max.'),
      types: { ...vehicles, description: 'Affected types; omitted means all.' },
      max: int(0, 15, 'Absolute vmax cap applied after delta.'),
      cells: int(1, 36, 'Only this many cells from the upstream end of the segment.'),
    },
    required: ['kind', 'delta'],
    additionalProperties: false,
  },
  banType: {
    type: 'object',
    properties: {
      kind: kind('banType'),
      vehicleType: vehicle,
      scope: {
        description:
          '"target" (default); "target-class": the placed segment\'s road class district-wide; or a fixed road class district-wide.',
        oneOf: [
          { type: 'string', enum: ['target', 'target-class'] },
          {
            type: 'object',
            properties: { roadClass: { type: 'string', enum: ROAD_CLASSES } },
            required: ['roadClass'],
            additionalProperties: false,
          },
        ],
      },
    },
    required: ['kind', 'vehicleType'],
    additionalProperties: false,
  },
  preferType: {
    type: 'object',
    properties: { kind: kind('preferType'), vehicleType: vehicle, alsoTypes: vehicles },
    required: ['kind', 'vehicleType'],
    additionalProperties: false,
  },
  setBusStopDwell: {
    type: 'object',
    properties: { kind: kind('setBusStopDwell'), dwellTicks: int(0, 40) },
    required: ['kind', 'dwellTicks'],
    additionalProperties: false,
  },
  addBikeLane: {
    type: 'object',
    properties: {
      kind: kind('addBikeLane'),
      bikeVmax: int(1, 5),
      carVmaxDelta: int(-4, 0),
    },
    required: ['kind', 'bikeVmax', 'carVmaxDelta'],
    additionalProperties: false,
  },
  addTurnLane: {
    type: 'object',
    properties: { kind: kind('addTurnLane'), turns: { type: 'string', enum: ['left', 'both'] } },
    required: ['kind', 'turns'],
    additionalProperties: false,
  },
  reserveLane: {
    type: 'object',
    properties: { kind: kind('reserveLane'), vehicleTypes: vehicles },
    required: ['kind', 'vehicleTypes'],
    additionalProperties: false,
  },
  setOneWay: {
    type: 'object',
    properties: {
      kind: kind('setOneWay'),
      direction: { ...side, description: 'Omitted: along the placed segment, from -> to.' },
      doubleLanes: { type: 'boolean' },
    },
    required: ['kind', 'doubleLanes'],
    additionalProperties: false,
  },
  reroute: {
    type: 'object',
    properties: {
      kind: kind('reroute'),
      percent: int(1, 100),
      to: {
        type: 'string',
        enum: ['adjacent', 'secondary'],
        description: 'adjacent: next edge clockwise; secondary: the edge the player also picks.',
      },
      vehicleTypes: vehicles,
    },
    required: ['kind', 'percent', 'to'],
    additionalProperties: false,
  },
  spawnModifier: {
    type: 'object',
    properties: {
      kind: kind('spawnModifier'),
      vehicleType: vehicle,
      percent: nonZero(-100, 300, 'Whole percent change to spawns of this type.'),
    },
    required: ['kind', 'vehicleType', 'percent'],
    additionalProperties: false,
  },
  smoothDemand: {
    type: 'object',
    properties: {
      kind: kind('smoothDemand'),
      peakPermille: int(1, 1000, 'Drop in the peak spawn rate, per-mille.'),
    },
    required: ['kind', 'peakPermille'],
    additionalProperties: false,
  },
  spawnWindow: {
    type: 'object',
    properties: {
      kind: kind('spawnWindow'),
      vehicleType: vehicle,
      fromTick: int(0, 299),
      toTick: int(1, 300),
    },
    required: ['kind', 'vehicleType', 'fromTick', 'toTick'],
    additionalProperties: false,
  },
  scoreModifier: {
    type: 'object',
    properties: {
      kind: kind('scoreModifier'),
      vehicleType: vehicle,
      delta: nonZero(-10, 10),
      condition: { type: 'string', enum: ['above-quota', 'same-tick-window', 'on-arrival'] },
    },
    required: ['kind', 'delta'],
    additionalProperties: false,
  },
  setPSlow: {
    type: 'object',
    properties: { kind: kind('setPSlow'), deltaPermille: nonZero(-1000, 1000) },
    required: ['kind', 'deltaPermille'],
    additionalProperties: false,
  },
  yieldRule: {
    type: 'object',
    properties: { kind: kind('yieldRule'), fasterTicks: int(1, 20) },
    required: ['kind', 'fasterTicks'],
    additionalProperties: false,
  },
  drawModifier: {
    type: 'object',
    properties: { kind: kind('drawModifier'), delta: nonZero(-5, 5) },
    required: ['kind', 'delta'],
    additionalProperties: false,
  },
  energyModifier: {
    type: 'object',
    properties: {
      kind: kind('energyModifier'),
      delta: nonZero(-5, 5),
      perRound: { type: 'boolean' },
      when: { type: 'string', enum: ['now', 'next-round'] },
      condition: { type: 'string', enum: ['replaced-signal'] },
    },
    required: ['kind', 'delta', 'when'],
    additionalProperties: false,
  },
  costModifier: {
    type: 'object',
    properties: {
      kind: kind('costModifier'),
      cards: {
        oneOf: [
          { const: 'all' },
          {
            type: 'array',
            items: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
            minItems: 1,
            uniqueItems: true,
          },
        ],
      },
      delta: nonZero(-3, 3, 'Relative change; or use next + cost.'),
      next: int(1, 2, 'The next N cards played this round...'),
      cost: int(0, 3, '...cost exactly this much energy.'),
    },
    required: ['kind', 'cards'],
    additionalProperties: false,
  },
  redraw: {
    type: 'object',
    properties: { kind: kind('redraw'), keep: int(0, 1) },
    required: ['kind', 'keep'],
    additionalProperties: false,
  },
  fundsModifier: {
    type: 'object',
    properties: {
      kind: kind('fundsModifier'),
      delta: nonZero(-20, 20),
      per: int(1, 100, 'Earned once per this many vehicles.'),
    },
    required: ['kind', 'delta'],
    additionalProperties: false,
  },
};

const effects: JsonSchema = {
  type: 'array',
  items: { $ref: '#/$defs/effect' },
  minItems: 1,
  maxItems: 6,
};

/** The card schema. Written verbatim to `schema/card.schema.json`. */
export const CARD_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://rushwarden.com/schema/card.schema.json',
  title: 'Rushwarden card',
  description:
    'One card (GDD section 4). Card text is generated from effects; flavor is the only free text.',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    id: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 40 },
    name: { type: 'string', minLength: 1, maxLength: 24 },
    cost: int(1, 3, 'Energy cost.'),
    target: { type: 'string', enum: TARGET_KINDS },
    duration: { type: 'string', enum: DURATIONS },
    rarity: { type: 'string', enum: RARITIES },
    tags: {
      type: 'array',
      items: { type: 'string', enum: TAGS },
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
    },
    effects,
    upgrade: {
      type: 'object',
      description: 'Tier 2: each field given replaces the tier-1 value.',
      properties: { cost: int(0, 3, 'Tier-2 energy cost.'), effects },
      minProperties: 1,
      additionalProperties: false,
    },
    flavor: { type: 'string', minLength: 1, maxLength: FLAVOR_MAX, pattern: '^[^\\n\\r]*$' },
  },
  required: [
    'id',
    'name',
    'cost',
    'target',
    'duration',
    'rarity',
    'tags',
    'effects',
    'upgrade',
    'flavor',
  ],
  additionalProperties: false,
  $defs: {
    vehicleType: { type: 'string', enum: VEHICLE_NAMES },
    side: { type: 'string', enum: SIDES },
    effect: { oneOf: Object.values(EFFECT_SCHEMAS) },
  },
};
