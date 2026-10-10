/**
 * The deterministic run controller (P1-BAL-01, ADR-007 item 4, ADR-018). Pure functions over
 * plain-data state; the `RunController` class wraps them for the UI. The balance runner calls
 * `startRun`/`step` directly.
 */
export * from './types.js';
export { quotaFor, fundsFor, BASE_QUOTA, RUSH_PERMILLE } from './quota.js';
export { shuffle, draw } from './deck.js';
export { buildOffer, dominantTag, RARITY_WEIGHTS, OFFER_SIZE, PITY_AFTER_ROUND } from './offers.js';
export {
  startRun,
  step,
  replay,
  roundInput,
  resolveRound,
  costOf,
  deckOf,
  resolveTier,
} from './controller.js';
export { RunController, type RunAnalytics } from './run-controller.js';
export {
  toyRunConfig,
  fullRunConfig,
  PHASE1_STARTING_DECK,
  DISTRICT_BOSSES,
  DEFAULT_RULES,
} from './presets.js';
