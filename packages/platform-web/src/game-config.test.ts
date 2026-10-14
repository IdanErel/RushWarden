import { describe, expect, it } from 'vitest';
import { startRun, toyRunConfig } from '@rushwarden/app';
import {
  TOY_EXCLUDED_CARDS,
  TOY_ROUNDS,
  loadCards,
  roundQuota,
  setupRound,
  startingDeck,
  toyRushRounds,
} from '@rushwarden/content';
import { portalRules } from '@rushwarden/ui';
import { isPortalBuild, uiConfigFor, uiPortalFor } from './game-config.js';
import { PokiAdapter } from './portal/poki.js';

const POLICY = 'https://rushwarden.com/privacy';
const portal = (id: 'none' | 'itch' | 'poki' | 'crazygames', opened: string[] = []) => ({
  id,
  shareUrl: () => `https://share.example/${id}`,
  openExternalLink: (url: string) => void opened.push(url),
});

describe('uiConfigFor', () => {
  it("tells the run screen the build's portal, so its portal rules apply (#71, ADR-024)", () => {
    for (const id of ['none', 'itch', 'poki', 'crazygames'] as const)
      expect(uiConfigFor({}, portal(id)).portal).toBe(id);
    const rules = portalRules(uiConfigFor({}, portal('poki')).portal);
    expect(rules).toEqual({ unlock: false, outboundLinks: false, analytics: false });
    expect(portalRules(uiConfigFor({}, portal('itch')).portal).analytics).toBe(true);
  });

  it('maps any non-web adapter id to none', () => {
    for (const id of ['web', 'ios', 'android', 'steam', 'none'] as const)
      expect(uiPortalFor(id)).toBe('none');
  });

  it('links the privacy policy on every build, portals included (ADR-024 point 5)', () => {
    for (const id of ['none', 'itch', 'poki', 'crazygames'] as const)
      expect(uiConfigFor({ VITE_PRIVACY_URL: POLICY }, portal(id)).privacyUrl).toBe(POLICY);
  });

  it('treats Poki and CrazyGames as portal builds', () => {
    expect(['none', 'itch', 'poki', 'crazygames'].map((id) => isPortalBuild(id as 'none'))).toEqual(
      [false, false, true, true],
    );
  });

  it('shows no link until a policy https URL is set', () => {
    expect(uiConfigFor({}, portal('none')).privacyUrl).toBe('');
    expect(uiConfigFor({ VITE_PRIVACY_URL: 'http://x' }, portal('none')).privacyUrl).toBe('');
  });

  it("sends outbound links through the portal adapter's openExternalLink, on every build", () => {
    for (const id of ['none', 'itch', 'poki', 'crazygames'] as const) {
      const opened: string[] = [];
      const config = uiConfigFor({ VITE_PRIVACY_URL: POLICY }, portal(id, opened));
      config.openExternalLink?.(config.privacyUrl);
      expect(opened, id).toEqual([POLICY]);
    }
  });

  it("the Poki build's privacy link reaches PokiSDK.openExternalLink", async () => {
    const calls: string[] = [];
    const env = {
      global: {
        PokiSDK: {
          init: async () => undefined,
          gameLoadingFinished: () => undefined,
          gameplayStart: () => undefined,
          gameplayStop: () => undefined,
          shareableURL: async () => 'https://poki.com/en/g/rushwarden',
          openExternalLink: (u: string) => void calls.push(u),
        },
      },
      loadScript: async () => undefined,
      timeoutMs: 50,
      openWindow: (u: string) => void calls.push(`tab:${u}`),
    };
    const poki = new PokiAdapter({ shareUrl: 'https://rushwarden.com/', env });
    await poki.init();
    const config = uiConfigFor({ VITE_PRIVACY_URL: POLICY }, poki);
    config.openExternalLink?.(config.privacyUrl);
    expect(calls).toEqual([POLICY]);
  });

  it("uses the portal adapter's share link", () => {
    expect(uiConfigFor({}, portal('poki')).shareUrl).toBe('https://share.example/poki');
  });
});

describe('toy run wiring', () => {
  it("uses content's starting deck without the toy's excluded cards, and only content's cards", () => {
    const config = toyRunConfig({ seed: 1, cards: loadCards(), startingDeck: startingDeck() });
    const ids = new Set(config.cards.map((c) => c.id));
    // 12 cards less Overtime and Pilot Program (ADR-032, playtest E1).
    expect(config.startingDeck).toHaveLength(10);
    for (const id of TOY_EXCLUDED_CARDS) expect(ids.has(id)).toBe(false);
    for (const id of config.startingDeck) expect(ids.has(id)).toBe(true);
  });

  // The run controller takes its quota from content's roundQuota (#29). The toy's round 1 plays
  // D1 round TOY_ROUNDS[0] (ADR-030), a rush round with its boss.
  it("the toy run's round 1 is content's sampled D1 round, with its roundQuota and boss", () => {
    const config = toyRunConfig({ seed: 1, cards: loadCards(), startingDeck: startingDeck() });
    const s = startRun(config, { setupRound }).state;
    const d1 = TOY_ROUNDS[0] ?? 0;
    expect(s.round).toBe(1);
    // The toy scales the quota by the round's map (ADR-032).
    expect(s.quota).toBe(roundQuota(1, d1, true, 1000, s.map.id));
    expect(s.rush).toBe(true);
    expect(s.boss).toBe(toyRushRounds()[0]?.boss);
  });
});
