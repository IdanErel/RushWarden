import { fullRunConfig, toyRunConfig, type RunConfig } from '@rushwarden/app';
import { botByName } from './bots.js';
import { CARDS, CONTENT_ENV, STARTING_DECK } from './data.js';
import { runSeeds, type RunRecord, type RunSpec } from './runner.js';

/**
 * `full`: 12-round District 1 runs, the gate configuration (ADR-007, ADR-010 point 2).
 * `toy`: the 5-round itch toy run.
 */
export type Preset = 'full' | 'toy';
export const PRESETS: readonly Preset[] = ['full', 'toy'];

/**
 * A unit of work as plain data, so it can be posted to a worker thread: the worker rebuilds the
 * bot, env and cards from names. A job's records depend only on its fields.
 */
export interface RunJob {
  readonly bot: string;
  readonly seeds: readonly number[];
  readonly preset: Preset;
  readonly targetsPerKind: number;
}

export function configFor(preset: Preset): (seed: number) => RunConfig {
  return preset === 'toy'
    ? (seed) => toyRunConfig({ seed, cards: CARDS, startingDeck: STARTING_DECK })
    : (seed) => fullRunConfig({ seed, cards: CARDS, startingDeck: STARTING_DECK });
}

export function specFor(job: RunJob): RunSpec {
  return {
    bot: botByName(job.bot),
    config: configFor(job.preset),
    env: CONTENT_ENV,
    cards: CARDS,
    targetsPerKind: job.targetsPerKind,
  };
}

export function runJob(job: RunJob): RunRecord[] {
  return runSeeds(specFor(job), job.seeds);
}

/**
 * Splits (bot × seeds) into jobs of at most `chunk` seeds. Chunking only decides which worker
 * plays a run, never what the run does, so any chunk size gives the same records.
 */
export function splitJobs(
  bots: readonly string[],
  seeds: readonly number[],
  preset: Preset,
  targetsPerKind: number,
  chunk: number,
): RunJob[] {
  if (!Number.isInteger(chunk) || chunk < 1)
    throw new RangeError(`chunk must be ≥ 1, got ${chunk}`);
  const jobs: RunJob[] = [];
  for (const bot of bots)
    for (let i = 0; i < seeds.length; i += chunk)
      jobs.push({ bot, seeds: seeds.slice(i, i + chunk), preset, targetsPerKind });
  return jobs;
}
