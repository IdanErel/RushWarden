import { describe, expect, it } from 'vitest';
import {
  INSTALL_ID_KEY,
  createIngestClient,
  normalizeLocale,
  offIngestClient,
  type IngestClientOptions,
} from '../src/ingest/client.js';
import { validateEvent } from '../src/ingest/events.js';
import { INSTALL } from './fixtures.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

function client(over: Partial<IngestClientOptions> = {}) {
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
    const storage = memoryStorage();
    let n = 0;
    const ids = ['3b241101-e2bb-4255-8caf-4136c566a962', '9f8c1a52-0d3e-4c1b-b7a4-2e6f5d9c8b71'];
    const make = () => client({ storage, randomUUID: () => ids[n++]! }).c;
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
    expect(c.install).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('the off client sends nothing and has no install ID', () => {
    offIngestClient.track('app_open', {});
    expect(offIngestClient.install).toBeNull();
  });

  it('normalizes locales', () => {
    expect(normalizeLocale('EN-us')).toBe('en-us');
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh-Hant-TW');
    expect(normalizeLocale(undefined)).toBe('und');
    expect(normalizeLocale('not a locale')).toBe('und');
  });
});
