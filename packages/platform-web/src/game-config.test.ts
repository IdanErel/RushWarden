import { describe, expect, it } from 'vitest';
import { quotaFor, toyRunConfig } from '@rushwarden/app';
import { loadCards, roundQuota, startingDeck } from '@rushwarden/content';
import { isPortalBuild, uiConfigFor } from './game-config.js';

const POLICY = 'https://rushwarden.com/privacy';
const portal = (id: 'none' | 'itch' | 'poki' | 'crazygames') => ({
  id,
  shareUrl: () => `https://share.example/${id}`,
});

describe('uiConfigFor', () => {
  it('links the privacy policy on our site and itch, never on Poki or CrazyGames', () => {
    for (const id of ['none', 'itch'] as const)
      expect(uiConfigFor({ VITE_PRIVACY_URL: POLICY }, portal(id)).privacyUrl).toBe(POLICY);
    for (const id of ['poki', 'crazygames'] as const) {
      expect(isPortalBuild(id)).toBe(true);
      expect(uiConfigFor({ VITE_PRIVACY_URL: POLICY }, portal(id)).privacyUrl).toBe('');
    }
  });

  it('shows no link until a policy https URL is set', () => {
    expect(uiConfigFor({}, portal('none')).privacyUrl).toBe('');
    expect(uiConfigFor({ VITE_PRIVACY_URL: 'http://x' }, portal('none')).privacyUrl).toBe('');
  });

  it("uses the portal adapter's share link", () => {
    expect(uiConfigFor({}, portal('poki')).shareUrl).toBe('https://share.example/poki');
  });
});

describe('toy run wiring', () => {
  it("uses content's 12-card starting deck and only content's cards", () => {
    const config = toyRunConfig({ seed: 1, cards: loadCards(), startingDeck: startingDeck() });
    const ids = new Set(config.cards.map((c) => c.id));
    expect(config.startingDeck).toHaveLength(12);
    for (const id of config.startingDeck) expect(ids.has(id)).toBe(true);
  });

  // The run controller computes quotas itself (RunEnv has no quota hook); this pins it to
  // content's roundQuota for every toy round, so the HUD and content never disagree.
  it("the controller's quotas equal content's roundQuota for every toy round", () => {
    const config = toyRunConfig({ seed: 1, cards: loadCards() });
    for (let round = 1; round <= config.rounds; round++) {
      const rush = config.rushRounds.some((r) => r.round === round);
      expect(quotaFor(1, round, rush, config.quotaPermille)).toBe(roundQuota(1, round, rush));
    }
  });
});
