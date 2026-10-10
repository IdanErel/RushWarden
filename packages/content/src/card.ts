/**
 * Card types, the validator (schema plus the rules a schema cannot express) and the loader that
 * turns card JSON into data the sim and run controller use.
 */
import type { Effect, EffectKind, Placement, Target, VehicleType } from '@rushwarden/sim';
import {
  CARD_SCHEMA,
  type DURATIONS,
  type RARITIES,
  type TAGS,
  type TARGET_KINDS,
  VEHICLE_NAMES,
} from './card-schema.js';
import { type SchemaError, validateSchema } from './json-schema.js';

export type Tag = (typeof TAGS)[number];
export type TargetKind = (typeof TARGET_KINDS)[number];
export type Duration = (typeof DURATIONS)[number];
export type Rarity = (typeof RARITIES)[number];
export type Tier = 1 | 2;

/** Tier-2 deltas: every field present replaces the tier-1 value (GDD section 4 `upgrade`). */
export interface CardUpgrade {
  readonly cost?: 0 | 1 | 2 | 3;
  readonly effects?: readonly Effect[];
}

/** A validated card, with effects already in sim form. */
export interface CardDef {
  readonly id: string;
  readonly name: string;
  readonly cost: 1 | 2 | 3;
  readonly target: TargetKind;
  readonly duration: Duration;
  readonly rarity: Rarity;
  readonly tags: readonly Tag[];
  readonly effects: readonly Effect[];
  readonly upgrade: CardUpgrade;
  readonly flavor: string;
}

/** A card at a tier: what is actually played. */
export interface ResolvedCard {
  readonly id: string;
  readonly tier: Tier;
  readonly cost: number;
  readonly target: TargetKind;
  readonly effects: readonly Effect[];
}

export interface CardError extends SchemaError {
  /** File or label the card came from. */
  readonly source: string;
}

export type ParseResult =
  | { readonly ok: true; readonly card: CardDef }
  | { readonly ok: false; readonly errors: readonly CardError[] };

/**
 * Which target kinds each primitive makes sense on. A card whose effect cannot act on the card's
 * target is rejected. Extend when a new card legitimately needs another pairing.
 */
export const EFFECT_TARGETS: { readonly [K in EffectKind]: readonly TargetKind[] } = {
  setController: ['intersection', 'district'],
  setSignalPhase: ['intersection', 'segment', 'district'],
  setLaneCount: ['segment', 'district'],
  setSpeedLimit: ['intersection', 'segment', 'district'],
  banType: ['segment', 'district'],
  preferType: ['intersection', 'district'],
  addBusStop: ['segment'],
  addBikeLane: ['segment'],
  setOneWay: ['segment', 'district'],
  reroute: ['edge', 'district'],
  spawnModifier: ['edge', 'district'],
  scoreModifier: ['intersection', 'segment', 'edge', 'district'],
  setPSlow: ['segment', 'district'],
  yieldRule: ['intersection', 'district'],
  drawModifier: ['district'],
  energyModifier: ['intersection', 'segment', 'edge', 'district'],
  fundsModifier: ['intersection', 'segment', 'edge', 'district'],
};

const SINGLETON_KINDS = new Set<EffectKind>([
  'setController',
  'setSignalPhase',
  'setLaneCount',
  'addBusStop',
  'addBikeLane',
  'setOneWay',
  'setPSlow',
  'yieldRule',
  'drawModifier',
]);

const VEHICLE_KEYS = new Set(['vehicleType']);
const VEHICLE_LIST_KEYS = new Set(['types', 'alsoTypes', 'vehicleTypes']);

function toVehicleType(name: unknown): VehicleType {
  return VEHICLE_NAMES.indexOf(name as (typeof VEHICLE_NAMES)[number]) as VehicleType;
}

/** JSON effect (vehicle names) to sim effect (`VehicleType` numbers). Input is schema-valid. */
function toSimEffect(raw: Record<string, unknown>): Effect {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (VEHICLE_KEYS.has(key)) out[key] = toVehicleType(value);
    else if (VEHICLE_LIST_KEYS.has(key)) out[key] = (value as unknown[]).map(toVehicleType);
    else out[key] = value;
  }
  return out as unknown as Effect;
}

/** Rules beyond the schema for one effect list on a given target. */
function effectRules(effects: readonly Effect[], target: TargetKind, path: string): SchemaError[] {
  const errors: SchemaError[] = [];
  const seen = new Set<string>();
  effects.forEach((e, i) => {
    const at = `${path}/${i}`;
    if (!EFFECT_TARGETS[e.kind].includes(target)) {
      errors.push({ path: at, message: `${e.kind} cannot act on target "${target}"` });
    }
    if (e.kind === 'setController') {
      if (e.direction !== undefined && e.controller !== 'priority') {
        errors.push({ path: at, message: 'direction is only valid with controller "priority"' });
      }
      if (e.controller === 'priority' && e.direction === undefined) {
        errors.push({ path: at, message: 'controller "priority" needs a direction' });
      }
      if (e.capacity !== undefined && e.controller !== 'roundabout') {
        errors.push({ path: at, message: 'capacity is only valid with controller "roundabout"' });
      }
    }
    if (e.kind === 'preferType' && e.alsoTypes?.includes(e.vehicleType) === true) {
      errors.push({ path: at, message: 'alsoTypes repeats vehicleType' });
    }
    // A second effect of these kinds on one card would contradict the first.
    if (SINGLETON_KINDS.has(e.kind)) {
      if (seen.has(e.kind)) errors.push({ path: at, message: `duplicate ${e.kind} effect` });
      seen.add(e.kind);
    }
  });
  return errors;
}

/**
 * Validates one card's JSON and converts it. Collects every error rather than stopping at the
 * first, so a content PR sees all problems at once.
 */
export function parseCard(raw: unknown, source = '(inline)'): ParseResult {
  const tag = (errors: readonly SchemaError[]): CardError[] =>
    errors.map((e) => ({ source, ...e }));
  const schemaErrors = validateSchema(CARD_SCHEMA, raw);
  if (schemaErrors.length > 0) return { ok: false, errors: tag(schemaErrors) };

  const json = raw as Record<string, unknown> & {
    target: TargetKind;
    effects: Record<string, unknown>[];
    upgrade: { cost?: 0 | 1 | 2 | 3; effects?: Record<string, unknown>[] };
  };
  const effects = json.effects.map(toSimEffect);
  const upgrade: CardUpgrade = {
    ...(json.upgrade.cost === undefined ? {} : { cost: json.upgrade.cost }),
    ...(json.upgrade.effects === undefined
      ? {}
      : { effects: json.upgrade.effects.map(toSimEffect) }),
  };
  const card: CardDef = {
    id: json['id'] as string,
    name: json['name'] as string,
    cost: json['cost'] as 1 | 2 | 3,
    target: json.target,
    duration: json['duration'] as Duration,
    rarity: json['rarity'] as Rarity,
    tags: json['tags'] as Tag[],
    effects,
    upgrade,
    flavor: json['flavor'] as string,
  };

  const errors = effectRules(effects, card.target, 'effects');
  if (upgrade.effects !== undefined) {
    errors.push(...effectRules(upgrade.effects, card.target, 'upgrade/effects'));
  }
  const t1 = resolveCard(card, 1);
  const t2 = resolveCard(card, 2);
  if (t1.cost === t2.cost && JSON.stringify(t1.effects) === JSON.stringify(t2.effects)) {
    errors.push({ path: 'upgrade', message: 'tier 2 must differ from tier 1' });
  }
  if (t2.cost > t1.cost) {
    errors.push({ path: 'upgrade/cost', message: 'tier 2 must not cost more than tier 1' });
  }
  return errors.length > 0 ? { ok: false, errors: tag(errors) } : { ok: true, card };
}

export interface CardFile {
  /** File name, e.g. `smart-signal.json`; must be `<id>.json`. */
  readonly source: string;
  readonly data: unknown;
}

/** Validates a whole card set: each card, plus unique ids and names and `<id>.json` file names. */
export function validateCards(files: readonly CardFile[]): {
  readonly cards: readonly CardDef[];
  readonly errors: readonly CardError[];
} {
  const cards: CardDef[] = [];
  const errors: CardError[] = [];
  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  for (const { source, data } of files) {
    const result = parseCard(data, source);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    const { card } = result;
    if (source.endsWith('.json') && source !== `${card.id}.json`) {
      errors.push({ source, path: 'id', message: `file must be named ${card.id}.json` });
    }
    const dupId = ids.get(card.id);
    if (dupId !== undefined) {
      errors.push({ source, path: 'id', message: `duplicate id, also in ${dupId}` });
    }
    const dupName = names.get(card.name.toLowerCase());
    if (dupName !== undefined) {
      errors.push({ source, path: 'name', message: `duplicate name, also in ${dupName}` });
    }
    ids.set(card.id, source);
    names.set(card.name.toLowerCase(), source);
    cards.push(card);
  }
  return { cards, errors };
}

/** Formats validation errors one per line: `file: path: message`. */
export function formatErrors(errors: readonly CardError[]): string {
  return errors.map((e) => `${e.source}: ${e.path}: ${e.message}`).join('\n');
}

/** The card at a tier: tier 2 applies the `upgrade` deltas. */
export function resolveCard(card: CardDef, tier: Tier): ResolvedCard {
  const up = tier === 2 ? card.upgrade : {};
  return {
    id: card.id,
    tier,
    cost: up.cost ?? card.cost,
    target: card.target,
    effects: up.effects ?? card.effects,
  };
}

/** Builds the sim `Placement` for playing `card` at `tier` on `target`. */
export function toPlacement(card: CardDef, tier: Tier, target: Target, order: number): Placement {
  if (target.kind !== card.target) {
    throw new Error(`${card.id} targets ${card.target}, not ${target.kind}`);
  }
  return { cardId: card.id, tier, target, effects: resolveCard(card, tier).effects, order };
}
