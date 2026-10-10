import type { AnalyticsEvent } from '../src/analytics/events.js';

export const INSTALL = '3b241101-e2bb-4255-8caf-4136c566a962';
export const INSTALL_2 = '9f8c1a52-0d3e-4c1b-b7a4-2e6f5d9c8b71';

const envelope = {
  install: INSTALL,
  platform: 'itch',
  version: '0.1.0',
  locale: 'en-US',
  deviceClass: 'mid',
} as const;

export const VALID: Record<AnalyticsEvent['event'], AnalyticsEvent> = {
  app_open: { ...envelope, event: 'app_open', props: {} },
  run_start: {
    ...envelope,
    event: 'run_start',
    props: { mayor: 'ada', district: 1, daily: false },
  },
  round_end: {
    ...envelope,
    event: 'round_end',
    props: {
      round: 3,
      pass: true,
      throughput: 41,
      quota: 32,
      cardsPlayed: ['smart-signal', 'one-way'],
    },
  },
  run_end: {
    ...envelope,
    event: 'run_end',
    props: { rounds: 5, result: 'win', deckTags: ['FLOW', 'FLOW', 'MASS', 'TEMPO'] },
  },
};
