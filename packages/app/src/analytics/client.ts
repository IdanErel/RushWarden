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
/**
 * localStorage key set to `1` while a "Delete my data" request has not succeeded yet. The ID is
 * kept until the server confirms, so the player can retry or email it (ADR-025 point 6).
 */
export const PENDING_DELETE_KEY = 'rushwarden.analytics.pendingDelete';

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
   * True while a "Delete my data" request has not succeeded. The ID is kept (nothing is sent) so
   * the Privacy panel can show it with a retry; the client also retries on every start.
   */
  readonly deletePending: boolean;
  /**
   * Records the player's answer. Yes creates the install ID; no deletes it locally and stops
   * sending (ADR-025). While a delete is pending, no keeps the ID and yes is ignored: the delete
   * must finish first.
   */
  setConsent(yes: boolean): void;
  /**
   * "Delete my data": records no (sending stops at once) and a pending delete, calls
   * `DELETE /ingest/:install`, and only when that succeeds deletes the local ID and the pending
   * flag. Resolves false if the request failed; the ID and the pending flag then survive reloads,
   * and the next start retries. Resolves true when there was nothing to delete.
   */
  deleteData(): Promise<boolean>;
}

/** Collection off: sends nothing, creates no install ID. */
export const offIngestClient: IngestClient = {
  track() {},
  install: null,
  consent: null,
  deletePending: false,
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
  const storedId = read(storage, INSTALL_ID_KEY);
  const validId = storedId && UUID_V4.test(storedId) ? storedId : null;
  let consent: Consent = stored === 'yes' || stored === 'no' ? stored : null;
  let pending = read(storage, PENDING_DELETE_KEY) === '1' && validId !== null;
  let install: string | null = null;
  if (pending) {
    // A delete that has not succeeded yet: keep the ID (never send with it) and retry below.
    consent = 'no';
    install = validId;
  } else {
    write(storage, PENDING_DELETE_KEY, null);
    if (consent === 'yes') {
      install = validId ?? randomUUID();
      write(storage, INSTALL_ID_KEY, install);
    } else if (storedId !== null) {
      write(storage, INSTALL_ID_KEY, null);
    }
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

  const client: IngestClient = {
    get install() {
      return install;
    },
    get consent() {
      return consent;
    },
    get deletePending() {
      return pending;
    },
    setConsent(yes) {
      if (pending) return; // The delete must finish first; consent is already no.
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
      const id = install;
      if (id === null) return true;
      pending = true;
      write(storage, PENDING_DELETE_KEY, '1');
      try {
        const res = await request(`${options.endpoint}/${id}`, { method: 'DELETE' });
        if ((res as { ok?: boolean } | undefined)?.ok === false) return false;
      } catch {
        return false;
      }
      if (install === id) {
        install = null;
        pending = false;
        write(storage, INSTALL_ID_KEY, null);
        write(storage, PENDING_DELETE_KEY, null);
      }
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
  if (pending) void client.deleteData();
  return client;
}
