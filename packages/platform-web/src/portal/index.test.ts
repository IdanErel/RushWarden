import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CrazyGamesAdapter,
  ItchAdapter,
  PokiAdapter,
  createPortalAdapter,
  parsePortalFlag,
} from './index.js';
import { checkBuildEnv, privacyUrlFrom } from './flag.js';
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

describe('checkBuildEnv (ADR-024 point 4)', () => {
  const URL = 'https://api.rushwarden.com/ingest';

  it('fails a Poki or CrazyGames build that sets VITE_INGEST_URL', () => {
    for (const portal of ['poki', 'crazygames'])
      expect(() => checkBuildEnv({ VITE_PORTAL: portal, VITE_INGEST_URL: URL })).toThrow(
        /VITE_INGEST_URL must not be set/,
      );
  });

  it('allows portal builds without it, and itch or own-site builds with it and a policy', () => {
    const P = 'https://rushwarden.com/privacy';
    expect(checkBuildEnv({ VITE_PORTAL: 'poki' })).toBe('poki');
    expect(checkBuildEnv({ VITE_PORTAL: 'crazygames', VITE_INGEST_URL: '' })).toBe('crazygames');
    expect(checkBuildEnv({ VITE_PORTAL: 'itch', VITE_INGEST_URL: URL, VITE_PRIVACY_URL: P })).toBe(
      'itch',
    );
    expect(checkBuildEnv({ VITE_INGEST_URL: URL, VITE_PRIVACY_URL: P })).toBe('none');
    expect(() => checkBuildEnv({ VITE_PORTAL: 'Poki' })).toThrow(/VITE_PORTAL/);
  });
});

describe('checkBuildEnv (ADR-025 point 5)', () => {
  const URL = 'https://api.rushwarden.com/ingest';

  it('fails any build that sets VITE_INGEST_URL without an https VITE_PRIVACY_URL', () => {
    for (const portal of [undefined, 'none', 'itch'])
      for (const policy of [undefined, '', 'http://rushwarden.com/privacy', '/privacy', 'https://'])
        expect(
          () =>
            checkBuildEnv({ VITE_PORTAL: portal, VITE_INGEST_URL: URL, VITE_PRIVACY_URL: policy }),
          `${portal} ${policy}`,
        ).toThrow(/needs an https VITE_PRIVACY_URL/);
  });

  it('does not need a policy while collection is off', () => {
    expect(checkBuildEnv({})).toBe('none');
    expect(checkBuildEnv({ VITE_PORTAL: 'itch', VITE_INGEST_URL: '' })).toBe('itch');
  });
});

describe('share URL on portals (ADR-024 point 5)', () => {
  it('fails a portal build that sets VITE_SHARE_URL', () => {
    for (const portal of ['poki', 'crazygames'])
      expect(() =>
        checkBuildEnv({ VITE_PORTAL: portal, VITE_SHARE_URL: 'https://rushwarden.com/' }),
      ).toThrow(/VITE_SHARE_URL must not be set in a .* build/);
    expect(checkBuildEnv({ VITE_PORTAL: 'poki', VITE_SHARE_URL: '' })).toBe('poki');
    expect(checkBuildEnv({ VITE_PORTAL: 'itch', VITE_SHARE_URL: 'https://x.com/' })).toBe('itch');
  });
});

describe('privacyUrlFrom', () => {
  it('returns the URL only when it is an absolute https URL', () => {
    expect(privacyUrlFrom({ VITE_PRIVACY_URL: 'https://rushwarden.com/privacy' })).toBe(
      'https://rushwarden.com/privacy',
    );
    for (const bad of [undefined, '', 'http://x.com/', '/privacy', 'https://', 'javascript:x'])
      expect(privacyUrlFrom({ VITE_PRIVACY_URL: bad }), String(bad)).toBe('');
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
