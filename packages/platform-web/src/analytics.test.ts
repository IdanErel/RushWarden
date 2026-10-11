import { describe, expect, it } from 'vitest';
import { portalRules } from '@rushwarden/ui';
import {
  deviceClassFromMs,
  platformFromPortalId,
  privacyControlsFor,
  startAnalytics,
} from './analytics.js';
import { uiPortalFor } from './game-config.js';

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962';
/** ADR-025 point 5: collection needs the published policy, so every "on" env carries it. */
const POLICY = 'https://rushwarden.com/privacy';

describe('startAnalytics', () => {
  it('is off (sends nothing, no install ID) unless VITE_INGEST_URL is an https URL', () => {
    for (const url of [undefined, '', 'http://api.rushwarden.com/ingest', 'false']) {
      const sent: unknown[] = [];
      const storage = new Map<string, string>();
      const c = startAnalytics({ VITE_INGEST_URL: url, VITE_PRIVACY_URL: POLICY }, 'itch', 10, {
        fetch: async (u) => void sent.push(u),
        storage: {
          getItem: (k) => storage.get(k) ?? null,
          setItem: (k, v) => void storage.set(k, v),
          removeItem: (k) => void storage.delete(k),
        },
      });
      c.setConsent(true);
      c.track('app_open', {});
      expect(c.install).toBeNull();
      expect(sent).toEqual([]);
      expect(storage.size).toBe(0);
    }
  });

  it('sends nothing before the player says yes, even when on', () => {
    const sent: unknown[] = [];
    const c = startAnalytics(
      { VITE_INGEST_URL: 'https://api.rushwarden.com/ingest', VITE_PRIVACY_URL: POLICY },
      'itch',
      30,
      {
        fetch: async (u) => void sent.push(u),
        storage: null,
        randomUUID: () => UUID,
      },
    );
    c.track('app_open', {});
    expect(c.install).toBeNull();
    expect(sent).toEqual([]);
  });

  it('sends app_open with the build platform, version and benchmark class when on', () => {
    const sent: string[] = [];
    const c = startAnalytics(
      {
        VITE_INGEST_URL: 'https://api.rushwarden.com/ingest',
        VITE_PRIVACY_URL: POLICY,
        VITE_APP_VERSION: '0.1.0',
      },
      'itch',
      30,
      {
        fetch: async (_u, init) => void sent.push(init.body as string),
        storage: null,
        randomUUID: () => UUID,
        language: 'en-GB',
      },
    );
    c.setConsent(true);
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

  it('is off on Poki and CrazyGames even with VITE_INGEST_URL set (ADR-024 point 4)', () => {
    for (const portal of ['poki', 'crazygames'] as const) {
      const sent: unknown[] = [];
      const c = startAnalytics(
        { VITE_INGEST_URL: 'https://api.rushwarden.com/ingest', VITE_PRIVACY_URL: POLICY },
        portal,
        30,
        {
          fetch: async (u) => void sent.push(u),
          storage: null,
          randomUUID: () => UUID,
        },
      );
      c.setConsent(true);
      c.track('app_open', {});
      expect(c.install).toBeNull();
      expect(sent).toEqual([]);
    }
  });

  it('is off without an https VITE_PRIVACY_URL, even with an ingest URL (ADR-025 point 5)', () => {
    for (const policy of [undefined, '', 'http://rushwarden.com/privacy', '/privacy', 'https://']) {
      const sent: unknown[] = [];
      const c = startAnalytics(
        { VITE_INGEST_URL: 'https://api.rushwarden.com/ingest', VITE_PRIVACY_URL: policy },
        'itch',
        30,
        { fetch: async (u) => void sent.push(u), storage: null, randomUUID: () => UUID },
      );
      c.setConsent(true);
      c.track('app_open', {});
      expect(c.install, String(policy)).toBeNull();
      expect(sent).toEqual([]);
      expect(privacyControlsFor(c)).toBeUndefined();
    }
  });

  it('maps portal ids and benchmark times', () => {
    expect(platformFromPortalId('none')).toBe('web');
    expect(platformFromPortalId('poki')).toBe('poki');
    expect(platformFromPortalId('crazygames')).toBe('crazygames');
    expect(platformFromPortalId('itch')).toBe('itch');
    expect([1, 20, 100].map(deviceClassFromMs)).toEqual(['high', 'mid', 'low']);
  });
});

describe('privacyControlsFor (ADR-025 consent and Privacy panels, #71)', () => {
  const ON = 'https://api.rushwarden.com/ingest';
  const deps = { fetch: async () => undefined, storage: null, randomUUID: () => UUID };

  it('gives the run screen nothing when collection is off: no ingest URL, or a portal build', () => {
    expect(privacyControlsFor(startAnalytics({}, 'itch', 10, deps))).toBeUndefined();
    for (const id of ['poki', 'crazygames'] as const)
      expect(
        privacyControlsFor(
          startAnalytics({ VITE_INGEST_URL: ON, VITE_PRIVACY_URL: POLICY }, id, 10, deps),
        ),
      ).toBeUndefined();
  });

  it('gives the live client when collection is on, so the panel drives consent and delete', () => {
    const client = startAnalytics(
      { VITE_INGEST_URL: ON, VITE_PRIVACY_URL: POLICY },
      'itch',
      10,
      deps,
    );
    const privacy = privacyControlsFor(client);
    expect(privacy).toBe(client);
    expect(privacy?.consent).toBeNull();
    expect(privacy?.install).toBeNull();
    privacy?.setConsent(true);
    expect(client.consent).toBe('yes');
    expect(privacy?.install).toBe(UUID);
  });

  it("matches the UI's portal rules: the panels show exactly where the build collects", () => {
    for (const id of ['none', 'itch', 'poki', 'crazygames'] as const) {
      const client = startAnalytics(
        { VITE_INGEST_URL: ON, VITE_PRIVACY_URL: POLICY },
        id,
        10,
        deps,
      );
      expect(privacyControlsFor(client) !== undefined, id).toBe(
        portalRules(uiPortalFor(id)).analytics,
      );
    }
  });
});
