/**
 * The only analytics events Phase 1 may send (ADR-007: `app_open`, `run_start`, `round_end`,
 * `run_end`) and the only fields each may carry (GDD §10). Everything else is rejected, on the
 * client before sending and on the server before storing. Adding an event or a field needs an ADR
 * (GDD §10) and a privacy policy update (`docs/legal/privacy.md`) in the same PR.
 *
 * There is deliberately no timestamp: the server stores its own receipt time (ADR-009).
 */

export const EVENT_NAMES = ['app_open', 'run_start', 'round_end', 'run_end'] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const PLATFORMS = [
  'itch',
  'poki',
  'crazygames',
  'web',
  'ios',
  'android',
  'steam',
  'none',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const DEVICE_CLASSES = ['low', 'mid', 'high'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export const TAGS = ['FLOW', 'MASS', 'TOLL', 'CHAOS', 'TEMPO'] as const;
export type Tag = (typeof TAGS)[number];

/** Per-event properties, exactly as GDD §10 lists them. */
export interface EventProps {
  app_open: Record<string, never>;
  run_start: { mayor: string; district: number; daily: boolean };
  round_end: {
    round: number;
    pass: boolean;
    throughput: number;
    quota: number;
    cardsPlayed: string[];
  };
  run_end: { rounds: number; result: 'win' | 'loss'; deckTags: Tag[] };
}

/** The fields every event carries (GDD §10): nothing else. */
export interface Envelope {
  install: string;
  platform: Platform;
  version: string;
  locale: string;
  deviceClass: DeviceClass;
}

export type AnalyticsEvent = {
  [E in EventName]: Envelope & { event: E; props: EventProps[E] };
}[EventName];

export type ValidationResult = { ok: true; value: AnalyticsEvent } | { ok: false; error: string };

/** Largest accepted request body in bytes; a valid event is well under 1 KB. */
export const MAX_BODY_BYTES = 2048;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,20})?$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
/** Content ids are kebab-case (ADR-011: `cards/<id>.json`). */
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 40;
/** Generous caps: the toy plays at most 2 cards a round and 12 rounds a run. */
const MAX_CARDS_PER_ROUND = 8;
const MAX_ROUNDS = 999;
const MAX_DECK = 64;
const MAX_SCORE = 1_000_000;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exactKeys(o: Obj, keys: readonly string[], where: string): string | null {
  for (const k of Object.keys(o)) if (!keys.includes(k)) return `${where}: unknown field "${k}"`;
  for (const k of keys) if (!(k in o)) return `${where}: missing field "${k}"`;
  return null;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_ID_LENGTH && CONTENT_ID.test(v);
}

function oneOf<T extends string>(v: unknown, values: readonly T[]): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v);
}

function checkProps(event: EventName, p: Obj): string | null {
  switch (event) {
    case 'app_open':
      return exactKeys(p, [], 'props');
    case 'run_start':
      return (
        exactKeys(p, ['mayor', 'district', 'daily'], 'props') ??
        (!isId(p['mayor']) ? 'props.mayor: not a content id' : null) ??
        (!isInt(p['district'], 1, 3) ? 'props.district: not 1-3' : null) ??
        (typeof p['daily'] !== 'boolean' ? 'props.daily: not a boolean' : null)
      );
    case 'round_end': {
      const cards = p['cardsPlayed'];
      return (
        exactKeys(p, ['round', 'pass', 'throughput', 'quota', 'cardsPlayed'], 'props') ??
        (!isInt(p['round'], 1, MAX_ROUNDS) ? 'props.round: out of range' : null) ??
        (typeof p['pass'] !== 'boolean' ? 'props.pass: not a boolean' : null) ??
        (!isInt(p['throughput'], 0, MAX_SCORE) ? 'props.throughput: out of range' : null) ??
        (!isInt(p['quota'], 0, MAX_SCORE) ? 'props.quota: out of range' : null) ??
        (!Array.isArray(cards) || cards.length > MAX_CARDS_PER_ROUND || !cards.every(isId)
          ? 'props.cardsPlayed: not a short list of content ids'
          : null)
      );
    }
    case 'run_end': {
      const tags = p['deckTags'];
      return (
        exactKeys(p, ['rounds', 'result', 'deckTags'], 'props') ??
        (!isInt(p['rounds'], 0, MAX_ROUNDS) ? 'props.rounds: out of range' : null) ??
        (!oneOf(p['result'], ['win', 'loss'] as const) ? 'props.result: not win or loss' : null) ??
        (!Array.isArray(tags) || tags.length > MAX_DECK || !tags.every((t) => oneOf(t, TAGS))
          ? 'props.deckTags: not a list of archetype tags'
          : null)
      );
    }
  }
}

/** Validates an untrusted parsed body. Unknown or missing fields anywhere are an error. */
export function validateEvent(body: unknown): ValidationResult {
  if (!isObj(body)) return { ok: false, error: 'body: not an object' };
  const keyError = exactKeys(
    body,
    ['event', 'install', 'platform', 'version', 'locale', 'deviceClass', 'props'],
    'body',
  );
  if (keyError) return { ok: false, error: keyError };
  const { event, install, platform, version, locale, deviceClass, props } = body;
  if (!oneOf(event, EVENT_NAMES)) return { ok: false, error: 'event: not an allowed event' };
  if (typeof install !== 'string' || !UUID_V4.test(install))
    return { ok: false, error: 'install: not a lowercase v4 UUID' };
  if (!oneOf(platform, PLATFORMS)) return { ok: false, error: 'platform: unknown' };
  if (typeof version !== 'string' || !VERSION.test(version))
    return { ok: false, error: 'version: not semver' };
  if (typeof locale !== 'string' || !LOCALE.test(locale))
    return { ok: false, error: 'locale: not a language tag' };
  if (!oneOf(deviceClass, DEVICE_CLASSES)) return { ok: false, error: 'deviceClass: unknown' };
  if (!isObj(props)) return { ok: false, error: 'props: not an object' };
  const propsError = checkProps(event, props);
  if (propsError) return { ok: false, error: propsError };
  return { ok: true, value: body as unknown as AnalyticsEvent };
}
