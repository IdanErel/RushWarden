import { describe, expect, it } from 'vitest';
import {
  CONSENT_KEY,
  INSTALL_ID_KEY,
  PENDING_DELETE_KEY,
  createIngestClient,
  normalizeLocale,
  offIngestClient,
  type IngestClientOptions,
} from '../src/analytics/client.js';
import { validateEvent } from '../src/analytics/events.js';
import { INSTALL } from './analytics-fixtures.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

const YES = { [CONSENT_KEY]: 'yes' };

function client(over: Partial<IngestClientOptions> = {}, consent = true) {
  const sent: { url: string; init: RequestInit }[] = [];
  const c = createIngestClient({
    endpoint: 'https://api.rushwarden.com/ingest',
    platform: 'itch',
    version: '0.1.0',
    locale: 'en-US',
    deviceClass: 'mid',
    storage: memoryStorage(),
    fetch: async (url, init) => void sent.push({ url, init }),
    randomUUID: () => INSTALL,
    ...over,
  });
  if (consent) c.setConsent(true);
  return { c, sent };
}

describe('createIngestClient', () => {
  it('sends one valid event per call with only the §10 fields and no time', () => {
    const { c, sent } = client();
    c.track('app_open', {});
    c.track('round_end', {
      round: 1,
      pass: false,
      throughput: 10,
      quota: 26,
      cardsPlayed: ['detour'],
    });
    expect(sent).toHaveLength(2);
    for (const { url, init } of sent) {
      expect(url).toBe('https://api.rushwarden.com/ingest');
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
      });
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(validateEvent(body).ok).toBe(true);
      expect(Object.keys(body).sort()).toEqual([
        'deviceClass',
        'event',
        'install',
        'locale',
        'platform',
        'props',
        'version',
      ]);
    }
  });

  it('keeps one random install ID in storage and reuses it', () => {
    const storage = memoryStorage(YES);
    let n = 0;
    const ids = ['3b241101-e2bb-4255-8caf-4136c566a962', '9f8c1a52-0d3e-4c1b-b7a4-2e6f5d9c8b71'];
    const make = () => client({ storage, randomUUID: () => ids[n++]! }, false).c;
    expect(make().install).toBe(ids[0]);
    expect(make().install).toBe(ids[0]);
    expect(storage.map.get(INSTALL_ID_KEY)).toBe(ids[0]);
  });

  it('survives blocked storage and a failing network', async () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const { c } = client({ storage: throwing, fetch: () => Promise.reject(new Error('offline')) });
    expect(c.install).toBe(INSTALL);
    expect(() => c.track('app_open', {})).not.toThrow();
    const sync = client({
      fetch: () => {
        throw new Error('sync');
      },
    }).c;
    expect(() => sync.track('app_open', {})).not.toThrow();
  });

  it('drops invalid events instead of sending them', () => {
    const { c, sent } = client();
    c.track('run_start', { mayor: 'Not An Id', district: 1, daily: false });
    (c.track as (e: string, p: object) => void)('share', {});
    expect(sent).toHaveLength(0);
  });

  it('generates a v4 UUID by default', () => {
    const c = createIngestClient({
      endpoint: 'https://api.rushwarden.com/ingest',
      platform: 'itch',
      version: '0.1.0',
      locale: 'en',
      deviceClass: 'low',
      storage: null,
    });
    c.setConsent(true);
    expect(c.install).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('has no install ID, stores nothing and sends nothing before the player says yes', () => {
    const storage = memoryStorage();
    const { c, sent } = client({ storage }, false);
    expect(c.consent).toBeNull();
    c.track('app_open', {});
    expect(c.install).toBeNull();
    expect(sent).toEqual([]);
    expect(storage.map.size).toBe(0);
  });

  it('deletes a stored ID that has no stored yes', () => {
    const storage = memoryStorage({ [INSTALL_ID_KEY]: INSTALL });
    expect(client({ storage }, false).c.install).toBeNull();
    expect(storage.map.has(INSTALL_ID_KEY)).toBe(false);
    const no = memoryStorage({ [INSTALL_ID_KEY]: INSTALL, [CONSENT_KEY]: 'no' });
    expect(client({ storage: no }, false).c.install).toBeNull();
    expect(no.map.has(INSTALL_ID_KEY)).toBe(false);
  });

  it('yes creates and stores the ID; no deletes it and stops sending', () => {
    const storage = memoryStorage();
    const { c, sent } = client({ storage }, false);
    c.setConsent(true);
    expect(c.consent).toBe('yes');
    expect(storage.map.get(CONSENT_KEY)).toBe('yes');
    expect(storage.map.get(INSTALL_ID_KEY)).toBe(INSTALL);
    c.track('app_open', {});
    expect(sent).toHaveLength(1);
    c.setConsent(false);
    expect(c.install).toBeNull();
    expect(storage.map.get(CONSENT_KEY)).toBe('no');
    expect(storage.map.has(INSTALL_ID_KEY)).toBe(false);
    c.track('app_open', {});
    expect(sent).toHaveLength(1);
  });

  it('delete my data calls DELETE /ingest/:install, then forgets the ID', async () => {
    const storage = memoryStorage();
    const { c, sent } = client({ storage });
    expect(await c.deleteData()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`https://api.rushwarden.com/ingest/${INSTALL}`);
    expect(sent[0]?.init).toMatchObject({
      method: 'DELETE',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    expect(c.install).toBeNull();
    expect(c.consent).toBe('no');
    expect(storage.map.has(INSTALL_ID_KEY)).toBe(false);
    c.track('app_open', {});
    expect(sent).toHaveLength(1);
    expect(await c.deleteData()).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('keeps the ID and a pending flag when the delete request fails', async () => {
    for (const fail of [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve({ ok: false }),
    ]) {
      const storage = memoryStorage();
      let calls = 0;
      const { c, sent } = client({
        storage,
        fetch: (url, init) => {
          if (init.method === 'DELETE') {
            calls++;
            return fail();
          }
          sent.push({ url, init });
          return Promise.resolve();
        },
      });
      expect(await c.deleteData()).toBe(false);
      expect(calls).toBe(1);
      expect(c.install).toBe(INSTALL);
      expect(c.consent).toBe('no');
      expect(c.deletePending).toBe(true);
      expect(storage.map.get(INSTALL_ID_KEY)).toBe(INSTALL);
      expect(storage.map.get(PENDING_DELETE_KEY)).toBe('1');
      // Nothing is sent while the delete is pending, and yes cannot override it.
      c.setConsent(true);
      c.setConsent(false);
      c.track('app_open', {});
      expect(sent).toEqual([]);
      expect(c.install).toBe(INSTALL);
    }
  });

  it('after a reload, keeps the ID of a failed delete and retries until it succeeds', async () => {
    const storage = memoryStorage();
    const deletes: string[] = [];
    let online = false;
    const fetch = (url: string, init: RequestInit) => {
      if (init.method !== 'DELETE') return Promise.resolve();
      deletes.push(url);
      return online ? Promise.resolve({ ok: true }) : Promise.reject(new Error('offline'));
    };
    const first = client({ storage, fetch }).c;
    expect(await first.deleteData()).toBe(false);

    // Reload while still offline: the ID survives and the start retries.
    const second = client({ storage, fetch }, false).c;
    expect(second.install).toBe(INSTALL);
    expect(second.deletePending).toBe(true);
    expect(second.consent).toBe('no');
    await Promise.resolve();
    expect(deletes).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(storage.map.get(INSTALL_ID_KEY)).toBe(INSTALL);

    // Reload once online: the retry at start deletes on the server, then forgets the ID.
    online = true;
    const third = client({ storage, fetch }, false).c;
    expect(third.install).toBe(INSTALL);
    await new Promise((r) => setTimeout(r, 0));
    expect(deletes).toEqual(Array(3).fill(`https://api.rushwarden.com/ingest/${INSTALL}`));
    expect(third.install).toBeNull();
    expect(third.deletePending).toBe(false);
    expect(storage.map.has(INSTALL_ID_KEY)).toBe(false);
    expect(storage.map.has(PENDING_DELETE_KEY)).toBe(false);

    // And the next reload has nothing left to delete.
    const fourth = client({ storage, fetch }, false).c;
    expect(fourth.install).toBeNull();
    expect(deletes).toHaveLength(3);
  });

  it('drops a pending flag that has no ID left', () => {
    const storage = memoryStorage({ [PENDING_DELETE_KEY]: '1' });
    const { c } = client({ storage }, false);
    expect(c.deletePending).toBe(false);
    expect(storage.map.has(PENDING_DELETE_KEY)).toBe(false);
  });

  it('the off client sends nothing and has no install ID', async () => {
    offIngestClient.setConsent(true);
    offIngestClient.track('app_open', {});
    expect(offIngestClient.install).toBeNull();
    expect(offIngestClient.consent).toBeNull();
    expect(offIngestClient.deletePending).toBe(false);
    expect(await offIngestClient.deleteData()).toBe(true);
  });

  it('normalizes locales', () => {
    expect(normalizeLocale('EN-us')).toBe('en-us');
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh-Hant-TW');
    expect(normalizeLocale(undefined)).toBe('und');
    expect(normalizeLocale('not a locale')).toBe('und');
  });
});
