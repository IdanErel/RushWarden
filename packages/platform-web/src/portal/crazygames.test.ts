import { describe, expect, it } from 'vitest';
import { CRAZYGAMES_SDK_URL, CrazyGamesAdapter } from './crazygames.js';
import { fakeEnv } from './fake-env.test-helper.js';

const SHARE = 'https://rushwarden.com/';

function installCrazy(
  opts: { environment?: string; game?: Record<string, unknown>; init?: unknown } = {},
) {
  return (g: Record<string, unknown>, calls: string[]) => {
    const rec =
      (name: string, ret?: unknown) =>
      (...args: unknown[]) => {
        calls.push(args.length ? `${name}(${JSON.stringify(args)})` : name);
        return ret;
      };
    g['CrazyGames'] = {
      SDK: {
        init: opts.init ?? rec('init', Promise.resolve()),
        environment: opts.environment ?? 'crazygames',
        ad: { requestAd: rec('requestAd'), hasAdblock: rec('hasAdblock', Promise.resolve(false)) },
        game: {
          loadingStart: rec('loadingStart'),
          loadingStop: rec('loadingStop'),
          gameplayStart: rec('gameplayStart'),
          gameplayStop: rec('gameplayStop'),
          happytime: rec('happytime'),
          inviteLink: rec('inviteLink', 'https://www.crazygames.com/game/rushwarden?x=1'),
          ...opts.game,
        },
      },
    };
  };
}

describe('CrazyGamesAdapter', () => {
  it('loads SDK v3 from the official URL on init, once', async () => {
    const env = fakeEnv(installCrazy());
    const cg = new CrazyGamesAdapter({ shareUrl: SHARE, env });
    expect(env.loaded).toEqual([]);
    await Promise.all([cg.init(), cg.init()]);
    expect(env.loaded).toEqual([CRAZYGAMES_SDK_URL]);
  });

  it('brackets loading, alternates gameplay events and celebrates on happyTime', async () => {
    const env = fakeEnv(installCrazy());
    const cg = new CrazyGamesAdapter({ shareUrl: SHARE, env });
    await cg.init();
    cg.loadingFinished();
    cg.gameplayStart();
    cg.gameplayStart();
    cg.gameplayStop();
    cg.gameplayStop();
    cg.happyTime();
    expect(env.calls).toEqual([
      'init',
      'loadingStart',
      'inviteLink([{}])',
      'loadingStop',
      'gameplayStart',
      'gameplayStop',
      'happytime',
    ]);
  });

  it('stops loading before the first gameplayStart if loadingFinished was not called', async () => {
    const env = fakeEnv(installCrazy());
    const cg = new CrazyGamesAdapter({ shareUrl: SHARE, env });
    await cg.init();
    cg.gameplayStart();
    expect(env.calls.slice(-2)).toEqual(['loadingStop', 'gameplayStart']);
  });

  it('never requests ads', async () => {
    const env = fakeEnv(installCrazy());
    const cg = new CrazyGamesAdapter({ shareUrl: SHARE, env });
    await cg.init();
    await cg.commercialBreak();
    expect(env.calls.some((c) => c.startsWith('requestAd'))).toBe(false);
  });

  it('uses the invite link (sync or async) and allows in-portal sales', async () => {
    const cg = new CrazyGamesAdapter({ shareUrl: SHARE, env: fakeEnv(installCrazy()) });
    await cg.init();
    expect(cg.shareUrl()).toBe('https://www.crazygames.com/game/rushwarden?x=1');
    expect(cg.canSellInPortal()).toBe(true);
    expect(cg.id).toBe('crazygames');

    const asyncLink = new CrazyGamesAdapter({
      shareUrl: SHARE,
      env: fakeEnv(
        installCrazy({ game: { inviteLink: () => Promise.resolve('https://cg.example/a') } }),
      ),
    });
    await asyncLink.init();
    expect(asyncLink.shareUrl()).toBe('https://cg.example/a');
  });

  it('acts as no portal when the SDK environment is disabled (not on a CrazyGames domain)', async () => {
    const env = fakeEnv(installCrazy({ environment: 'disabled' }));
    const cg = new CrazyGamesAdapter({ shareUrl: SHARE, env });
    await cg.init();
    cg.gameplayStart();
    cg.happyTime();
    expect(env.calls).toEqual(['init']);
    expect(cg.shareUrl()).toBe(SHARE);
  });

  it('boots when the script is blocked, init rejects, or init hangs', async () => {
    const cases = [
      fakeEnv(installCrazy(), { fail: true }),
      fakeEnv(installCrazy({ init: () => Promise.reject(new Error('x')) })),
      fakeEnv(installCrazy({ init: () => new Promise(() => undefined) })),
      fakeEnv((g) => (g['CrazyGames'] = { SDK: { init: () => Promise.resolve() } })),
    ];
    for (const env of cases) {
      const cg = new CrazyGamesAdapter({ shareUrl: SHARE, env });
      await expect(cg.init()).resolves.toBeUndefined();
      cg.gameplayStart();
      cg.happyTime();
      expect(env.calls).not.toContain('gameplayStart');
    }
  });
});
