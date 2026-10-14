import { toyRunConfig, type RunAnalytics, type RunEnv } from '@rushwarden/app';
import type { RoundResult } from '@rushwarden/sim';
import { DEV_CARDS, DEV_STARTING_DECK, devCatalog, devEnv } from '../dev/cards.js';
import { ControllerRun } from '../src/run/controller-run.js';

export function devRun(
  seed: number,
  analytics?: RunAnalytics,
  env: RunEnv = devEnv,
): ControllerRun {
  return new ControllerRun({
    // Pinned past the toy's card exclusions (ADR-032 E1), like the dev page.
    config: {
      ...toyRunConfig({ seed, cards: DEV_CARDS }),
      cards: DEV_CARDS,
      startingDeck: DEV_STARTING_DECK,
    },
    env,
    catalog: devCatalog,
    analytics: analytics ?? null,
  });
}

/** A round result as the worker would post it. */
export function result(throughput: number, gridlocked = false): RoundResult {
  return {
    throughput,
    spawned: throughput,
    exited: throughput,
    ticks: gridlocked ? 120 : 300,
    gridlocked,
    fundsDelta: 0,
    finalHash: '0123456789abcdef',
  };
}
