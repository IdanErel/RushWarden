/**
 * @rushwarden/balance — headless balance runner, drafter bots and report generator (GDD §11,
 * P1-BAL-02, ADR-019).
 */
export {
  randomBot,
  greedyBot,
  archetypeBot,
  phase1Bots,
  botByName,
  botContext,
  ARCHETYPE_TAGS,
  type Bot,
  type BotContext,
} from './bots.js';
export { runOne, runSeeds, seedSet, canonical, type RunRecord, type RunSpec } from './runner.js';
export { renderReport, gateCriterion2, summarizeDeck, type ReportMeta } from './report.js';
export {
  runJob,
  splitJobs,
  specFor,
  configFor,
  PRESETS,
  type Preset,
  type RunJob,
} from './jobs.js';
export { runJobs, workerPool, type Executor } from './pool.js';
export {
  buildReport,
  formatReport,
  dataWarnings,
  BOT_NAMES,
  TUNING_WARNINGS,
  roundsOf,
} from './balance.js';
export { candidateTargets, spread } from './targets.js';
export { CARDS, CONTENT_ENV, STARTING_DECK } from './data.js';
