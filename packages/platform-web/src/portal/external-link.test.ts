import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrazyGamesAdapter } from './crazygames.js';
import { fakeEnv, type FakeEnv } from './fake-env.test-helper.js';
import { createPortalAdapter } from './index.js';
import { ItchAdapter } from './itch.js';
import { PokiAdapter } from './poki.js';
import { isHttpsUrl } from './types.js';
import { SpyPortalAdapter, type PortalCall } from '../test-hooks.js';

const SHARE = 'https://rushwarden.com/';
const PRIVACY = 'https://rushwarden.com/privacy';

/** A fake env whose `openWindow` records URLs, so no test opens a real tab. */
function linkEnv(
  install: (g: Record<string, unknown>, calls: string[]) => void,
  opts: { fail?: boolean } = {},
): FakeEnv & { opened: string[] } {
  const opened: string[] = [];
  return { ...fakeEnv(install, opts), opened, openWindow: (url: string) => opened.push(url) };
}

function pokiSdk(extra: Record<string, unknown> = {}) {
  return (g: Record<string, unknown>, calls: string[]) => {
    const rec =
      (name: string, ret?: unknown) =>
      (...args: unknown[]) => {
        calls.push(args.length ? `${name}(${JSON.stringify(args)})` : name);
        return ret;
      };
    g['PokiSDK'] = {
      init: rec('init', Promise.resolve()),
      gameLoadingFinished: rec('gameLoadingFinished'),
      gameplayStart: rec('gameplayStart'),
      gameplayStop: rec('gameplayStop'),
      shareableURL: rec('shareableURL', Promise.resolve(SHARE)),
      openExternalLink: rec('openExternalLink'),
      ...extra,
    };
  };
}

describe('isHttpsUrl', () => {
  it('accepts only absolute https URLs', () => {
    expect(isHttpsUrl(PRIVACY)).toBe(true);
    for (const bad of ['http://rushwarden.com/', 'javascript:alert(1)', '/privacy', '', 'x'])
      expect(isHttpsUrl(bad), bad).toBe(false);
  });
});

describe('openExternalLink', () => {
  it('Poki: goes through PokiSDK.openExternalLink and never opens a tab itself', async () => {
    const env = linkEnv(pokiSdk());
    const poki = new PokiAdapter({ shareUrl: SHARE, env });
    await poki.init();
    poki.openExternalLink(PRIVACY);
    expect(env.calls).toContain(`openExternalLink(${JSON.stringify([PRIVACY])})`);
    expect(env.opened).toEqual([]);
  });

  it('Poki: falls back to a new tab when the SDK is blocked or lacks the method', async () => {
    const blocked = linkEnv(pokiSdk(), { fail: true });
    const a = new PokiAdapter({ shareUrl: SHARE, env: blocked });
    await a.init();
    a.openExternalLink(PRIVACY);
    expect(blocked.opened).toEqual([PRIVACY]);

    const old = linkEnv(pokiSdk({ openExternalLink: undefined }));
    const b = new PokiAdapter({ shareUrl: SHARE, env: old });
    await b.init();
    b.openExternalLink(PRIVACY);
    expect(old.opened).toEqual([PRIVACY]);
  });

  it('Poki: an SDK error is swallowed and does not also open a tab', async () => {
    const env = linkEnv(
      pokiSdk({
        openExternalLink: () => {
          throw new Error('sdk bug');
        },
      }),
    );
    const poki = new PokiAdapter({ shareUrl: SHARE, env });
    await poki.init();
    expect(() => poki.openExternalLink(PRIVACY)).not.toThrow();
    expect(env.opened).toEqual([]);
  });

  it('CrazyGames and itch: a plain new tab', async () => {
    const cgEnv = linkEnv(() => undefined, { fail: true });
    const cg = new CrazyGamesAdapter({ shareUrl: SHARE, env: cgEnv });
    await cg.init();
    cg.openExternalLink(PRIVACY);
    expect(cgEnv.opened).toEqual([PRIVACY]);

    const itchEnv = linkEnv(() => undefined);
    new ItchAdapter({ shareUrl: SHARE, env: itchEnv }).openExternalLink(PRIVACY);
    expect(itchEnv.opened).toEqual([PRIVACY]);
  });

  it('every adapter ignores non-https URLs', async () => {
    const env = linkEnv(pokiSdk());
    const poki = new PokiAdapter({ shareUrl: SHARE, env });
    await poki.init();
    const cg = new CrazyGamesAdapter({ shareUrl: SHARE, env });
    const itch = new ItchAdapter({ shareUrl: SHARE, env });
    for (const a of [poki, cg, itch]) {
      a.openExternalLink('javascript:alert(1)');
      a.openExternalLink('http://rushwarden.com/privacy');
    }
    expect(env.opened).toEqual([]);
    expect(env.calls.filter((c) => c.startsWith('openExternalLink'))).toEqual([]);
  });

  describe('own-site build (no portal)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('opens a new tab with no opener', () => {
      const open = vi.fn();
      vi.stubGlobal('open', open);
      createPortalAdapter({ shareUrl: SHARE }).openExternalLink(PRIVACY);
      expect(open).toHaveBeenCalledWith(PRIVACY, '_blank', 'noopener,noreferrer');
    });
  });

  it('the H4 spy records the call and delegates', () => {
    const env = linkEnv(() => undefined);
    const calls: PortalCall[] = [];
    new SpyPortalAdapter(new ItchAdapter({ shareUrl: SHARE, env }), calls).openExternalLink(
      PRIVACY,
    );
    expect(calls).toEqual(['openExternalLink']);
    expect(env.opened).toEqual([PRIVACY]);
  });
});
