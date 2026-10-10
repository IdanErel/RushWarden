import { describe, expect, it } from 'vitest';
import { POKI_SDK_URL, PokiAdapter } from './poki.js';
import { fakeEnv } from './fake-env.test-helper.js';

const SHARE = 'https://rushwarden.com/';

function installPoki(over: Record<string, unknown> = {}) {
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
      commercialBreak: rec('commercialBreak', Promise.resolve()),
      rewardedBreak: rec('rewardedBreak', Promise.resolve(false)),
      shareableURL: rec('shareableURL', Promise.resolve('https://poki.com/en/g/rushwarden')),
      ...over,
    };
  };
}

describe('PokiAdapter', () => {
  it('loads the SDK from the official URL only on init, once', async () => {
    const env = fakeEnv(installPoki());
    const poki = new PokiAdapter({ shareUrl: SHARE, env });
    expect(env.loaded).toEqual([]);
    await Promise.all([poki.init(), poki.init()]);
    expect(env.loaded).toEqual([POKI_SDK_URL]);
    expect(env.calls.filter((c) => c === 'init')).toHaveLength(1);
  });

  it('reports loading and alternates gameplayStart/Stop without duplicates', async () => {
    const env = fakeEnv(installPoki());
    const poki = new PokiAdapter({ shareUrl: SHARE, env });
    await poki.init();
    poki.loadingFinished();
    poki.loadingFinished();
    poki.gameplayStart();
    poki.gameplayStart();
    poki.gameplayStop();
    poki.gameplayStop();
    poki.gameplayStart();
    expect(env.calls).toEqual([
      'init',
      'shareableURL([{}])',
      'gameLoadingFinished',
      'gameplayStart',
      'gameplayStop',
      'gameplayStart',
    ]);
  });

  it('never shows ads: commercialBreak and happyTime do not reach the SDK', async () => {
    const env = fakeEnv(installPoki());
    const poki = new PokiAdapter({ shareUrl: SHARE, env });
    await poki.init();
    await poki.commercialBreak();
    poki.happyTime();
    expect(env.calls).not.toContain('commercialBreak');
    expect(env.calls).not.toContain('rewardedBreak');
  });

  it('uses the Poki shareable URL and forbids in-portal sales', async () => {
    const poki = new PokiAdapter({ shareUrl: SHARE, env: fakeEnv(installPoki()) });
    expect(poki.shareUrl()).toBe(SHARE);
    await poki.init();
    expect(poki.shareUrl()).toBe('https://poki.com/en/g/rushwarden');
    expect(poki.canSellInPortal()).toBe(false);
    expect(poki.id).toBe('poki');
  });

  it('keeps the configured share URL when shareableURL fails or hangs', async () => {
    for (const shareableURL of [
      () => Promise.reject(new Error('no')),
      () => new Promise(() => undefined),
      () => Promise.resolve('javascript:alert(1)'),
    ]) {
      const poki = new PokiAdapter({
        shareUrl: SHARE,
        env: fakeEnv(installPoki({ shareableURL })),
      });
      await poki.init();
      expect(poki.shareUrl()).toBe(SHARE);
    }
  });

  it('boots without the SDK when the script is blocked; hooks are safe no-ops', async () => {
    const env = fakeEnv(installPoki(), { fail: true });
    const poki = new PokiAdapter({ shareUrl: SHARE, env });
    await expect(poki.init()).resolves.toBeUndefined();
    poki.loadingFinished();
    poki.gameplayStart();
    poki.gameplayStop();
    await poki.commercialBreak();
    expect(env.calls).toEqual([]);
  });

  it('still reports events when init rejects (ad blocker), as Poki asks', async () => {
    const env = fakeEnv(installPoki({ init: () => Promise.reject(new Error('adblock')) }));
    const poki = new PokiAdapter({ shareUrl: SHARE, env });
    await poki.init();
    poki.gameplayStart();
    expect(env.calls).toContain('gameplayStart');
  });

  it('ignores a malformed global and survives SDK methods that throw', async () => {
    const bad = new PokiAdapter({
      shareUrl: SHARE,
      env: fakeEnv((g) => (g['PokiSDK'] = { init: 1 })),
    });
    await bad.init();
    bad.gameplayStart();

    const throwing = new PokiAdapter({
      shareUrl: SHARE,
      env: fakeEnv(
        installPoki({
          gameplayStart: () => {
            throw new Error('sdk bug');
          },
        }),
      ),
    });
    await throwing.init();
    expect(() => throwing.gameplayStart()).not.toThrow();
  });
});
