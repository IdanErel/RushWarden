import { describe, expect, it } from 'vitest';
import { EVENT_NAMES, validateEvent } from '../src/ingest/events.js';
import { VALID } from './fixtures.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('validateEvent', () => {
  it('accepts exactly the four ADR-007 events', () => {
    expect(EVENT_NAMES).toEqual(['app_open', 'run_start', 'round_end', 'run_end']);
    for (const e of Object.values(VALID))
      expect(validateEvent(clone(e))).toEqual({ ok: true, value: e });
  });

  it('rejects every other GDD §10 event', () => {
    for (const event of [
      'card_offered',
      'card_picked',
      'unlock_viewed',
      'share',
      'error',
      'settings_changed',
    ]) {
      expect(validateEvent({ ...VALID.app_open, event }).ok).toBe(false);
    }
  });

  it('rejects any extra field: no client timestamp, no IP, nothing outside §10', () => {
    for (const extra of ['ts', 'time', 'timestamp', 'ip', 'userAgent', 'sessionId', 'email']) {
      expect(validateEvent({ ...VALID.app_open, [extra]: 1 }).ok).toBe(false);
      const e = clone(VALID.round_end) as unknown as { props: Record<string, unknown> };
      e.props[extra] = 1;
      expect(validateEvent(e).ok).toBe(false);
    }
    expect(validateEvent({ ...VALID.app_open, props: { x: 1 } }).ok).toBe(false);
  });

  it('rejects missing fields', () => {
    for (const key of Object.keys(VALID.run_start)) {
      const e = clone(VALID.run_start) as unknown as Record<string, unknown>;
      Reflect.deleteProperty(e, key);
      expect(validateEvent(e).ok, key).toBe(false);
    }
    const e = clone(VALID.run_start) as unknown as { props: Record<string, unknown> };
    delete e.props['daily'];
    expect(validateEvent(e).ok).toBe(false);
  });

  it.each([
    ['install', 'not-a-uuid'],
    ['install', '3B241101-E2BB-4255-8CAF-4136C566A962'],
    ['platform', 'facebook'],
    ['version', 'latest'],
    ['locale', 'en_US'],
    ['locale', 'x'.repeat(40)],
    ['deviceClass', 'pixel-4a'],
    ['props', []],
  ])('rejects a bad envelope %s=%j', (key, value) => {
    expect(validateEvent({ ...VALID.app_open, [key]: value }).ok).toBe(false);
  });

  it.each([
    ['run_start', { mayor: 'Ada Lovelace', district: 1, daily: false }],
    ['run_start', { mayor: 'ada', district: 4, daily: false }],
    ['run_start', { mayor: 'ada', district: 1, daily: 'no' }],
    ['round_end', { round: 0, pass: true, throughput: 1, quota: 1, cardsPlayed: [] }],
    ['round_end', { round: 1, pass: true, throughput: -1, quota: 1, cardsPlayed: [] }],
    ['round_end', { round: 1, pass: true, throughput: 1.5, quota: 1, cardsPlayed: [] }],
    ['round_end', { round: 1, pass: 1, throughput: 1, quota: 1, cardsPlayed: [] }],
    ['round_end', { round: 1, pass: true, throughput: 1, quota: 1, cardsPlayed: ['<script>'] }],
    [
      'round_end',
      { round: 1, pass: true, throughput: 1, quota: 1, cardsPlayed: Array(9).fill('a') },
    ],
    ['run_end', { rounds: 5, result: 'draw', deckTags: [] }],
    ['run_end', { rounds: 5, result: 'win', deckTags: ['flow'] }],
  ])('rejects bad %s props %j', (event, props) => {
    expect(validateEvent({ ...VALID.app_open, event, props }).ok).toBe(false);
  });

  it('rejects non-objects', () => {
    for (const v of [null, 1, 'x', [VALID.app_open]]) expect(validateEvent(v).ok).toBe(false);
  });
});
