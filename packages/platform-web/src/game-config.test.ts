import { describe, expect, it } from 'vitest';
import { startRun, toyRunConfig } from '@rushwarden/app';
import { loadCards, roundQuota, setupRound, startingDeck } from '@rushwarden/content';
import { isPortalBuild, uiConfigFor } from './game-config.js';

const POLICY = 'https://rushwarden.com/privacy';
const portal = (id: 'none' | 'itch' | 'poki' | 'crazygames') => ({
  id,
  shareUrl: () => `https://share.example/${id}`,
});

describe('uiConfigFor', () => {
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

  // The run controller takes its quota from content's roundQuota (#29); the toy's run uses it.
  it("the toy run's round 1 quota is content's roundQuota", () => {
    const config = toyRunConfig({ seed: 1, cards: loadCards(), startingDeck: startingDeck() });
    const s = startRun(config, { setupRound }).state;
    expect(s.quota).toBe(roundQuota(1, 1, false));
  });
});
