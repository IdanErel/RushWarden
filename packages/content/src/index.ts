/**
 * @rushwarden/content — cards, maps, districts, mayors and demand templates as validated JSON.
 *
 * ```ts
 * import { loadCards, cardText, toPlacement } from '@rushwarden/content';
 * const cards = loadCards();                 // validated; throws listing every error
 * cardText(cards[0]!, 2);                    // generated rules text at tier 2
 * ```
 */
import { type CardDef, formatErrors, validateCards } from './card.js';
import { CARD_FILES } from './cards.js';
import { MAP_FILES } from './map-files.js';
import { type RoundSetup, type SetupRoundArgs, setupRoundFrom } from './demand.js';
import {
  type District,
  type MapTemplate,
  mapsForDistrict,
  pickMap,
  validateMapTemplates,
} from './maps.js';
import type { GridMap } from '@rushwarden/sim';

export {
  type CardDef,
  type CardError,
  type CardFile,
  type CardUpgrade,
  type Duration,
  type ParseResult,
  type Rarity,
  type ResolvedCard,
  type Tag,
  type TargetKind,
  type Tier,
  EFFECT_TARGETS,
  formatErrors,
  parseCard,
  needsSecondaryTarget,
  resolveCard,
  toPlacement,
  validateCards,
} from './card.js';
export {
  CARD_SCHEMA,
  EFFECT_SCHEMAS,
  FLAVOR_MAX,
  RARITIES,
  TAGS,
  TARGET_KINDS,
  VEHICLE_NAMES,
} from './card-schema.js';
export { cardText, effectText, signed } from './text.js';
export { type JsonSchema, type SchemaError, validateSchema } from './json-schema.js';
export { CARD_FILES } from './cards.js';

export {
  DISTRICT_MAP_RULES,
  mapsForDistrict,
  pickMap,
  rowsToGridMap,
  templateVariants,
  transformRows,
  validateMapTemplates,
  VARIANTS,
  type District,
  type DistrictMapRules,
  type MapError,
  type MapFile,
  type MapTemplate,
  type Variant,
} from './maps.js';
export { MAP_CHARS, MAP_SCHEMA } from './map-schema.js';
export {
  BASE_QUOTA,
  DISTRICT_DEMAND,
  EDGE_WEIGHT_MAX,
  generateDemand,
  heatStrip,
  MARKET_DAY_TRUCKS_PER_SECOND,
  mixCounts,
  ROUND_GROWTH_PERMILLE,
  ROUND_SECONDS,
  roundQuota,
  roundVehicles,
  RUSH_PERMILLE,
  RUSH_ROUNDS,
  SECOND_WEIGHTS,
  SEED_SALTS,
  setupRoundFrom,
  SUPPORTED_BOSSES,
  type DemandArgs,
  type DemandMix,
  type DistrictDemand,
  type HeatStrip,
  type HeatStripRow,
  type RoundSetup,
  type SetupRoundArgs,
} from './demand.js';
export {
  edgesConnectedWithout,
  interiorSegments,
  paradeCandidates,
  pickParadeSegment,
  type SegmentId,
} from './parade.js';
export { MAP_FILES } from './map-files.js';

let cache: readonly CardDef[] | undefined;

/** The bundled cards, validated once. Throws with every error if any card is invalid. */
export function loadCards(): readonly CardDef[] {
  if (cache === undefined) {
    const { cards, errors } = validateCards(CARD_FILES);
    if (errors.length > 0) throw new Error(`Invalid card data:\n${formatErrors(errors)}`);
    cache = cards;
  }
  return cache;
}

let mapCache: readonly MapTemplate[] | undefined;

/** The bundled map templates, validated once. Throws listing every error. */
export function loadMapTemplates(): readonly MapTemplate[] {
  if (mapCache === undefined) {
    const { templates, errors } = validateMapTemplates(MAP_FILES);
    if (errors.length > 0) {
      throw new Error(
        `Invalid map data:\n${errors.map((e) => `${e.source}: ${e.path}: ${e.message}`).join('\n')}`,
      );
    }
    mapCache = templates;
  }
  return mapCache;
}

/** Every bundled map (template variants included) for a district. */
export function districtMaps(district: District): readonly GridMap[] {
  return mapsForDistrict(loadMapTemplates(), district);
}

/**
 * Sets up one round from its seed with the bundled maps: map, demand profile, heat-strip, quota
 * and district rules (P1-CON-04). The argument matches the run controller's
 * `RunEnv.setupRound`, so `{ setupRound }` can be passed to it as is.
 */
export function setupRound(args: SetupRoundArgs): RoundSetup {
  return setupRoundFrom(args, districtMaps, pickMap);
}

/** One bundled card by id. Throws if unknown. */
export function getCard(id: string): CardDef {
  const card = loadCards().find((c) => c.id === id);
  if (card === undefined) throw new Error(`Unknown card ${id}`);
  return card;
}
