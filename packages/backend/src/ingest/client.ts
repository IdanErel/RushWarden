import {
  validateEvent,
  type DeviceClass,
  type EventName,
  type EventProps,
  type Platform,
} from './events.js';

/** localStorage key of the random install ID (privacy policy: cleared with site data). */
export const INSTALL_ID_KEY = 'rushwarden.install';

export interface IngestClient {
  /** Sends one event now (ADR-009: unbatched). Invalid events are dropped, never sent. */
  track<E extends EventName>(event: E, props: EventProps[E]): void;
  /** The random install ID, or null when collection is off. */
  readonly install: string | null;
}

/** Collection off: sends nothing, creates no install ID. */
export const offIngestClient: IngestClient = { track() {}, install: null };

export interface IngestClientOptions {
  /** Full URL of `POST /ingest`. */
  endpoint: string;
  platform: Platform;
  version: string;
  locale: string;
  deviceClass: DeviceClass;
  storage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  } | null;
  fetch?: (input: string, init: RequestInit) => Promise<unknown>;
  randomUUID?: () => string;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;

function defaultUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function loadInstallId(storage: IngestClientOptions['storage'], randomUUID: () => string): string {
  try {
    const stored = storage?.getItem(INSTALL_ID_KEY);
    if (stored && UUID_V4.test(stored)) return stored;
  } catch {
    // Storage blocked (e.g. third-party iframe): use a per-page-load ID.
  }
  const id = randomUUID();
  try {
    storage?.setItem(INSTALL_ID_KEY, id);
  } catch {
    // Not persisted; fine.
  }
  return id;
}

/** Normalizes a browser language tag to what the schema accepts, or "und". */
export function normalizeLocale(tag: string | undefined): string {
  if (!tag) return 'und';
  const [lang = '', ...rest] = tag.split('-');
  const out = [lang.toLowerCase(), ...rest.slice(0, 2)].join('-');
  return LOCALE.test(out) ? out : 'und';
}

/**
 * Creates the analytics client. Only create it when collection is switched on: the web build
 * keeps it off unless `VITE_INGEST_URL` is set, which public builds must not do until the privacy
 * policy is published (ADR-007).
 */
export function createIngestClient(options: IngestClientOptions): IngestClient {
  const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const install = loadInstallId(options.storage, options.randomUUID ?? defaultUUID);
  const locale = normalizeLocale(options.locale);
  return {
    install,
    track(event, props) {
      const body = {
        event,
        install,
        platform: options.platform,
        version: options.version,
        locale,
        deviceClass: options.deviceClass,
        props,
      };
      if (!validateEvent(body).ok) return;
      try {
        void send(options.endpoint, {
          method: 'POST',
          // text/plain keeps this a CORS "simple request": no preflight round trip.
          headers: { 'content-type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(body),
          keepalive: true,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          mode: 'cors',
        }).catch(() => undefined);
      } catch {
        // Analytics must never break the game.
      }
    },
  };
}
