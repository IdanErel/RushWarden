import {
  validateEvent,
  type DeviceClass,
  type EventName,
  type EventProps,
  type Platform,
} from './events.js';

/** localStorage key of the random install ID (privacy policy: cleared with site data). */
export const INSTALL_ID_KEY = 'rushwarden.install';
/** localStorage key of the player's analytics answer: `yes` or `no` (ADR-025). */
export const CONSENT_KEY = 'rushwarden.analytics';

/** The player's analytics answer. `null` = not asked yet, which counts as no (ADR-025). */
export type Consent = 'yes' | 'no' | null;

export interface IngestClient {
  /**
   * Sends one event now (ADR-009: unbatched), only after the player said yes. Invalid events are
   * dropped, never sent.
   */
  track<E extends EventName>(event: E, props: EventProps[E]): void;
  /** The random install ID, or null when collection is off or the player has not said yes. */
  readonly install: string | null;
  /** The stored answer; `null` until the player answers. */
  readonly consent: Consent;
  /**
   * Records the player's answer. Yes creates the install ID; no deletes it locally and stops
   * sending (ADR-025).
   */
  setConsent(yes: boolean): void;
  /**
   * "Delete my data": calls `DELETE /ingest/:install`, then deletes the local ID and records no.
   * Resolves false if the request failed; the ID is then kept (sending stays off) so the player can
   * retry. Resolves true when there was nothing to delete.
   */
  deleteData(): Promise<boolean>;
}

/** Collection off: sends nothing, creates no install ID. */
export const offIngestClient: IngestClient = {
  track() {},
  install: null,
  consent: null,
  setConsent() {},
  deleteData: () => Promise.resolve(true),
};

export interface IngestClientOptions {
  /** Full URL of `POST /ingest`; the delete goes to `<endpoint>/<install>`. */
  endpoint: string;
  platform: Platform;
  version: string;
  locale: string;
  deviceClass: DeviceClass;
  storage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  } | null;
  /** Resolves to something with `ok` (a Response); a missing `ok` counts as success. */
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

type Storage = IngestClientOptions['storage'];

function read(storage: Storage, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null; // Storage blocked (e.g. third-party iframe): nothing persists past this page.
  }
}

function write(storage: Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Not persisted; fine.
  }
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
 *
 * Opt-in (ADR-025): until the player says yes, the client has no install ID, stores none and sends
 * nothing. A stored ID without a stored yes (e.g. from a build before consent) is deleted.
 */
export function createIngestClient(options: IngestClientOptions): IngestClient {
  const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const randomUUID = options.randomUUID ?? defaultUUID;
  const { storage } = options;
  const locale = normalizeLocale(options.locale);

  const stored = read(storage, CONSENT_KEY);
  let consent: Consent = stored === 'yes' || stored === 'no' ? stored : null;
  let install: string | null = null;
  if (consent === 'yes') {
    const id = read(storage, INSTALL_ID_KEY);
    install = id && UUID_V4.test(id) ? id : randomUUID();
    write(storage, INSTALL_ID_KEY, install);
  } else if (read(storage, INSTALL_ID_KEY) !== null) {
    write(storage, INSTALL_ID_KEY, null);
  }

  function request(url: string, init: RequestInit): Promise<unknown> {
    try {
      return send(url, {
        ...init,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        mode: 'cors',
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  return {
    get install() {
      return install;
    },
    get consent() {
      return consent;
    },
    setConsent(yes) {
      consent = yes ? 'yes' : 'no';
      write(storage, CONSENT_KEY, consent);
      if (yes) {
        install ??= randomUUID();
        write(storage, INSTALL_ID_KEY, install);
      } else {
        install = null;
        write(storage, INSTALL_ID_KEY, null);
      }
    },
    async deleteData() {
      consent = 'no';
      write(storage, CONSENT_KEY, consent);
      if (install === null) return true;
      try {
        const res = await request(`${options.endpoint}/${install}`, { method: 'DELETE' });
        if ((res as { ok?: boolean } | undefined)?.ok === false) return false;
      } catch {
        return false;
      }
      install = null;
      write(storage, INSTALL_ID_KEY, null);
      return true;
    },
    track(event, props) {
      if (consent !== 'yes' || install === null) return;
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
      // text/plain keeps this a CORS "simple request": no preflight round trip.
      request(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => undefined); // Analytics must never break the game.
    },
  };
}
