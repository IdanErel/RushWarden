import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CrazyGamesAdapter,
  ItchAdapter,
  PokiAdapter,
  createPortalAdapter,
  parsePortalFlag,
} from './index.js';
import { fakeEnv } from './fake-env.test-helper.js';

const SHARE = 'https://rushwarden.com/';

describe('parsePortalFlag', () => {
  it('defaults to none and accepts the known portals', () => {
    expect(parsePortalFlag(undefined)).toBe('none');
    expect(parsePortalFlag('')).toBe('none');
    for (const f of ['none', 'itch', 'poki', 'crazygames']) expect(parsePortalFlag(f)).toBe(f);
  });

  it('throws on an unknown flag so the build fails', () => {
    expect(() => parsePortalFlag('Poki')).toThrow(/VITE_PORTAL/);
  });
});

describe('createPortalAdapter', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('picks the adapter for the VITE_PORTAL build flag', () => {
    const env = fakeEnv(() => undefined);
    const cases = [
      ['poki', PokiAdapter],
      ['crazygames', CrazyGamesAdapter],
      ['itch', ItchAdapter],
    ] as const;
    for (const [flag, cls] of cases) {
      vi.stubEnv('VITE_PORTAL', flag);
      expect(createPortalAdapter({ shareUrl: SHARE, env })).toBeInstanceOf(cls);
    }
    vi.stubEnv('VITE_PORTAL', '');
    expect(createPortalAdapter({ shareUrl: SHARE, env }).id).toBe('none');
  });

  it('itch and none load nothing and are safe no-ops', async () => {
    for (const flag of ['itch', ''] as const) {
      vi.stubEnv('VITE_PORTAL', flag);
      const env = fakeEnv(() => undefined);
      const a = createPortalAdapter({ shareUrl: SHARE, env });
      await a.init();
      a.loadingFinished();
      a.gameplayStart();
      a.gameplayStop();
      await a.commercialBreak();
      a.happyTime();
      expect(env.loaded).toEqual([]);
      expect(a.shareUrl()).toBe(SHARE);
    }
    vi.stubEnv('VITE_PORTAL', 'itch');
    expect(createPortalAdapter({ shareUrl: SHARE }).canSellInPortal()).toBe(true);
  });
});
