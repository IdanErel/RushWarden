import { VehicleType } from '@rushwarden/sim';
import { describe, expect, it } from 'vitest';
import {
  type CardDef,
  parseCard,
  resolveCard,
  toPlacement,
  validateCards,
  validateSchema,
  type JsonSchema,
} from '../src/index.js';
import { validCardJson } from './fixtures.js';

function errorsOf(raw: unknown): string[] {
  const r = parseCard(raw, 'test.json');
  return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`);
}

function withPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...validCardJson(), ...patch };
}

function parsed(raw: unknown): CardDef {
  const r = parseCard(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.card;
}

describe('parseCard: valid input', () => {
  it('accepts the fixture and keeps every anatomy field (GDD §4)', () => {
    const card = parsed({ $schema: '../schema/card.schema.json', ...validCardJson() });
    expect(card).toMatchObject({
      id: 'test-roundabout',
      name: 'Test Roundabout',
      cost: 1,
      target: 'intersection',
      duration: 'round',
      rarity: 'common',
      tags: ['CHAOS'],
      flavor: 'Nobody stops. Everybody yields. Mostly.',
    });
    expect(card.effects).toEqual([
      { kind: 'setController', controller: 'roundabout', capacity: 4 },
    ]);
  });

  it('converts vehicle names to VehicleType numbers in every vehicle field', () => {
    const card = parsed(
      withPatch({
        target: 'district',
        effects: [
          { kind: 'spawnModifier', vehicleType: 'bus', percent: 40 },
          { kind: 'setSpeedLimit', delta: 1, types: ['car', 'bike'] },
          { kind: 'preferType', vehicleType: 'bus', alsoTypes: ['taxi'] },
          { kind: 'reroute', percent: 25, vehicleTypes: ['truck', 'emergency'] },
        ],
        upgrade: { cost: 0 },
      }),
    );
    expect(card.effects).toEqual([
      { kind: 'spawnModifier', vehicleType: VehicleType.Bus, percent: 40 },
      { kind: 'setSpeedLimit', delta: 1, types: [VehicleType.Car, VehicleType.Bike] },
      { kind: 'preferType', vehicleType: VehicleType.Bus, alsoTypes: [VehicleType.Taxi] },
      {
        kind: 'reroute',
        percent: 25,
        vehicleTypes: [VehicleType.Truck, VehicleType.Emergency],
      },
    ]);
  });

  it('counts flavor length in characters, not UTF-16 units', () => {
    expect(errorsOf(withPatch({ flavor: '\u{1F6A6}'.repeat(60) }))).toEqual([]);
    expect(errorsOf(withPatch({ flavor: 'x'.repeat(61) }))).toEqual([
      'flavor: must be at most 60 characters, got 61',
    ]);
  });
});

describe('parseCard: schema errors', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['cost below 1', { cost: 0 }, 'cost: must be >= 1'],
    ['cost above 3', { cost: 4 }, 'cost: must be <= 3'],
    ['fractional cost', { cost: 1.5 }, 'cost: must be an integer, got non-integer number'],
    ['bad target', { target: 'lane' }, 'target: must be one of'],
    ['bad duration', { duration: 'forever' }, 'duration: must be one of'],
    ['bad rarity', { rarity: 'mythic' }, 'rarity: must be one of'],
    ['unknown tag', { tags: ['SPEED'] }, 'tags/0: must be one of'],
    ['no tags', { tags: [] }, 'tags: must have at least 1 items'],
    ['three tags', { tags: ['FLOW', 'MASS', 'TOLL'] }, 'tags: must have at most 2 items'],
    ['duplicate tags', { tags: ['FLOW', 'FLOW'] }, 'tags: must not contain duplicates'],
    ['bad id', { id: 'Smart Signal' }, 'id: must match'],
    ['empty name', { name: '' }, 'name: must be at least 1 characters'],
    ['multi-line flavor', { flavor: 'a\nb' }, 'flavor: must match'],
    ['no effects', { effects: [] }, 'effects: must have at least 1 items'],
    ['effects not array', { effects: {} }, 'effects: must be an array, got object'],
    ['empty upgrade', { upgrade: {} }, 'upgrade: must have at least 1 properties'],
    ['upgrade cost 4', { upgrade: { cost: 4 } }, 'upgrade/cost: must be <= 3'],
    ['unknown field', { text: 'hand-written' }, '(root): unknown property "text"'],
    [
      'unknown effect kind',
      { effects: [{ kind: 'teleport' }] },
      'effects/0: "kind" must be one of',
    ],
    [
      'effect missing field',
      { effects: [{ kind: 'setController' }] },
      'effects/0: missing required property "controller"',
    ],
    [
      'effect extra field',
      { effects: [{ kind: 'setController', controller: 'signal', colour: 'red' }] },
      'effects/0: unknown property "colour"',
    ],
    [
      'unknown vehicle',
      { target: 'segment', effects: [{ kind: 'banType', vehicleType: 'tank' }] },
      'effects/0/vehicleType: must be one of',
    ],
    [
      'zero delta',
      { target: 'segment', effects: [{ kind: 'setSpeedLimit', delta: 0 }] },
      'effects/0/delta: must not be 0',
    ],
    [
      'boolean field',
      { target: 'segment', effects: [{ kind: 'setOneWay', direction: 'n', doubleLanes: 1 }] },
      'effects/0/doubleLanes: must be a boolean, got number',
    ],
    [
      'string field',
      { effects: [{ kind: 'setController', controller: 7 }] },
      'effects/0/controller: must be one of',
    ],
  ];
  it.each(cases)('rejects %s', (_label, patch, expected) => {
    const errors = errorsOf(withPatch(patch));
    expect(
      errors.some((e) => e.startsWith(expected)),
      errors.join('\n'),
    ).toBe(true);
  });

  it('rejects a non-object and reports missing required fields', () => {
    expect(errorsOf(null)).toEqual(['(root): must be an object, got null']);
    expect(errorsOf([])).toEqual(['(root): must be an object, got array']);
    expect(errorsOf({})).toContain('(root): missing required property "flavor"');
  });
});

describe('parseCard: card rules beyond the schema', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    [
      'effect on a target it cannot act on',
      { target: 'edge', effects: [{ kind: 'setController', controller: 'signal' }] },
      'effects/0: setController cannot act on target "edge"',
    ],
    [
      'upgrade effect on a wrong target',
      { upgrade: { effects: [{ kind: 'addBusStop', dwellTicks: 2 }] } },
      'upgrade/effects/0: addBusStop cannot act on target "intersection"',
    ],
    [
      'direction without priority',
      { effects: [{ kind: 'setController', controller: 'signal', direction: 'n' }] },
      'effects/0: direction is only valid with controller "priority"',
    ],
    [
      'priority without direction',
      { effects: [{ kind: 'setController', controller: 'priority' }] },
      'effects/0: controller "priority" needs a direction',
    ],
    [
      'capacity without roundabout',
      { effects: [{ kind: 'setController', controller: 'signal', capacity: 4 }] },
      'effects/0: capacity is only valid with controller "roundabout"',
    ],
    [
      'alsoTypes repeating vehicleType',
      { effects: [{ kind: 'preferType', vehicleType: 'bus', alsoTypes: ['bus'] }] },
      'effects/0: alsoTypes repeats vehicleType',
    ],
    [
      'two contradicting controllers',
      {
        effects: [
          { kind: 'setController', controller: 'signal' },
          { kind: 'setController', controller: 'roundabout' },
        ],
      },
      'effects/1: duplicate setController effect',
    ],
    [
      'tier 2 identical to tier 1',
      { upgrade: { cost: 1 } },
      'upgrade: tier 2 must differ from tier 1',
    ],
    ['tier 2 costing more', { upgrade: { cost: 2 } }, 'upgrade/cost: tier 2 must not cost more'],
  ];
  it.each(cases)('rejects %s', (_label, patch, expected) => {
    const errors = errorsOf(withPatch(patch));
    expect(
      errors.some((e) => e.startsWith(expected)),
      errors.join('\n'),
    ).toBe(true);
  });

  it('allows several modifiers of one kind on different vehicle types', () => {
    expect(
      errorsOf(
        withPatch({
          target: 'district',
          effects: [
            { kind: 'spawnModifier', vehicleType: 'bus', percent: 40 },
            { kind: 'spawnModifier', vehicleType: 'car', percent: -20 },
          ],
          upgrade: { cost: 0 },
        }),
      ),
    ).toEqual([]);
  });
});

describe('validateCards', () => {
  it('requires <id>.json file names, unique ids and unique names', () => {
    const a = validCardJson();
    const b = { ...validCardJson(), name: 'Other' };
    const c = { ...validCardJson(), id: 'other' };
    const { cards, errors } = validateCards([
      { source: 'test-roundabout.json', data: a },
      { source: 'wrong-name.json', data: b },
      { source: 'other.json', data: c },
      { source: 'broken.json', data: { id: 'broken' } },
    ]);
    expect(cards).toHaveLength(3);
    const lines = errors.map((e) => `${e.source}: ${e.path}: ${e.message}`);
    expect(lines).toContain('wrong-name.json: id: file must be named test-roundabout.json');
    expect(lines).toContain('wrong-name.json: id: duplicate id, also in test-roundabout.json');
    expect(lines).toContain('other.json: name: duplicate name, also in test-roundabout.json');
    expect(lines.some((l) => l.startsWith('broken.json: (root): missing required'))).toBe(true);
  });
});

describe('resolveCard and toPlacement', () => {
  const card = parsed(withPatch({ upgrade: { cost: 0, effects: validCardJson()['effects'] } }));
  const roundabout = parsed(validCardJson());

  it('tier 1 is the base card; tier 2 applies only the fields upgrade gives', () => {
    expect(resolveCard(card, 1)).toMatchObject({ cost: 1, tier: 1 });
    expect(resolveCard(card, 2)).toMatchObject({ cost: 0, tier: 2, effects: card.effects });
    expect(resolveCard(roundabout, 2)).toMatchObject({
      cost: 1,
      effects: [{ kind: 'setController', controller: 'roundabout', capacity: 6 }],
    });
  });

  it('builds a Placement with the tier-resolved effects', () => {
    const target = { kind: 'intersection', tile: { x: 3, y: 4 } } as const;
    expect(toPlacement(roundabout, 2, target, 1)).toEqual({
      cardId: 'test-roundabout',
      tier: 2,
      target,
      effects: [{ kind: 'setController', controller: 'roundabout', capacity: 6 }],
      order: 1,
    });
    expect(() => toPlacement(roundabout, 1, { kind: 'district' }, 0)).toThrow(/targets/);
  });
});

describe('validateSchema (JSON Schema subset)', () => {
  it('handles a generic oneOf that is not a kind-discriminated union', () => {
    const schema: JsonSchema = { oneOf: [{ type: 'integer' }, { type: 'string' }] };
    expect(validateSchema(schema, 3)).toEqual([]);
    expect(validateSchema(schema, true)[0]?.message).toMatch(/exactly one/);
  });

  it('refuses schemas that use keywords it does not implement', () => {
    expect(() => validateSchema({ type: 'string', format: 'email' } as JsonSchema, 'a')).toThrow(
      /Unsupported schema keyword "format"/,
    );
    expect(() => validateSchema({ $ref: '#/definitions/x' }, 1)).toThrow(/Unsupported \$ref/);
    expect(() => validateSchema({ $ref: '#/$defs/x' }, 1)).toThrow(/Unresolved \$ref/);
  });
});
