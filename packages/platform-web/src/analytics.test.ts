import { describe, expect, it } from 'vitest';
import { deviceClassFromMs, platformFromFlag, startAnalytics } from './analytics.js';

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962';

describe('startAnalytics', () => {
  it('is off (sends nothing, no install ID) unless VITE_INGEST_URL is an https URL', () => {
    for (const url of [undefined, '', 'http://api.rushwarden.com/ingest', 'false']) {
      const sent: unknown[] = [];
      const storage = new Map<string, string>();
      const c = startAnalytics({ VITE_INGEST_URL: url }, 10, {
        fetch: async (u) => void sent.push(u),
        storage: {
          getItem: (k) => storage.get(k) ?? null,
          setItem: (k, v) => void storage.set(k, v),
        },
      });
      c.track('app_open', {});
      expect(c.install).toBeNull();
      expect(sent).toEqual([]);
      expect(storage.size).toBe(0);
    }
  });

  it('sends app_open with the build platform, version and benchmark class when on', () => {
    const sent: string[] = [];
    const c = startAnalytics(
      {
        VITE_INGEST_URL: 'https://api.rushwarden.com/ingest',
        VITE_PORTAL: 'itch',
        VITE_APP_VERSION: '0.1.0',
      },
      30,
      {
        fetch: async (_u, init) => void sent.push(init.body as string),
        storage: null,
        randomUUID: () => UUID,
        language: 'en-GB',
      },
    );
    c.track('app_open', {});
    expect(JSON.parse(sent[0] ?? '')).toEqual({
      event: 'app_open',
      install: UUID,
      platform: 'itch',
      version: '0.1.0',
      locale: 'en-GB',
      deviceClass: 'mid',
      props: {},
    });
  });

  it('maps flags and benchmark times', () => {
    expect(platformFromFlag(undefined)).toBe('web');
    expect(platformFromFlag('none')).toBe('web');
    expect(platformFromFlag('poki')).toBe('poki');
    expect(platformFromFlag('weird')).toBe('web');
    expect([1, 20, 100].map(deviceClassFromMs)).toEqual(['high', 'mid', 'low']);
  });
});
