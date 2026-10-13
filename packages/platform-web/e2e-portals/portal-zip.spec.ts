import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { SDK_URLS } from '../scripts/portal-checks.mjs';
import { readZip } from '../scripts/zip.mjs';

// P1-PLT-02: the GDD §9 portal SDK checks on the artifacts Idan uploads. Each zip is served from
// a subfolder in a 390×844 iframe, its SDK URL answers with a stub that records every call, and a
// whole run is played. The run must:
// - wrap every round in gameplayStart/gameplayStop, after the loading event;
// - never call an ad API (ADR-013, ADR-024 decision 1);
// - create no AudioContext before a user gesture;
// - request nothing but its own files and its portal's SDK (ADR-024 points 4 and 5).
type Portal = keyof typeof SDK_URLS;
const PORTALS: readonly Portal[] = ['poki', 'crazygames'];
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'portals');
const BASE = '/games/rushwarden/';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
/** Calls that would show or request an ad. The stubs define them so a call is recorded, not thrown. */
const AD_CALLS = ['commercialBreak', 'rewardedBreak', 'ad.requestAd', 'ad.requestBanner'];

/** Stub SDKs: every method records its name in `window.__sdkCalls` of the game's frame. */
const STUBS: Record<Portal, string> = {
  poki: `(() => {
    const calls = (window.__sdkCalls = []);
    const rec = (name, value) => (...args) => { calls.push(name); return value; };
    window.PokiSDK = {
      init: rec('init', Promise.resolve()),
      gameLoadingFinished: rec('gameLoadingFinished'),
      gameplayStart: rec('gameplayStart'),
      gameplayStop: rec('gameplayStop'),
      shareableURL: rec('shareableURL', Promise.resolve('https://poki.com/en/g/rushwarden')),
      openExternalLink: rec('openExternalLink'),
      commercialBreak: rec('commercialBreak', Promise.resolve()),
      rewardedBreak: rec('rewardedBreak', Promise.resolve(false)),
    };
  })();`,
  crazygames: `(() => {
    const calls = (window.__sdkCalls = []);
    const rec = (name, value) => (...args) => { calls.push(name); return value; };
    window.CrazyGames = { SDK: {
      environment: 'crazygames',
      init: rec('init', Promise.resolve()),
      game: {
        loadingStart: rec('loadingStart'),
        loadingStop: rec('loadingStop'),
        gameplayStart: rec('gameplayStart'),
        gameplayStop: rec('gameplayStop'),
        happytime: rec('happytime'),
        inviteLink: rec('inviteLink', 'https://www.crazygames.com/game/rushwarden'),
      },
      ad: {
        requestAd: rec('ad.requestAd', Promise.resolve()),
        requestBanner: rec('ad.requestBanner', Promise.resolve()),
      },
    } };
  })();`,
};

/** Records AudioContext creation and whether the frame had a user gesture by then. */
const AUDIO_PROBE = `(() => {
  const made = (window.__audioContexts = []);
  for (const key of ['AudioContext', 'webkitAudioContext']) {
    const Real = window[key];
    if (!Real) continue;
    window[key] = class extends Real {
      constructor(...args) {
        super(...args);
        made.push(navigator.userActivation ? navigator.userActivation.hasBeenActive : null);
      }
    };
  }
})();`;

let server: Server;
let origin = '';
const zips = new Map<string, Map<string, Buffer>>();
const misses: string[] = [];

test.beforeAll(async () => {
  for (const portal of PORTALS) {
    const zip = join(DIR, `rushwarden-${portal}.zip`);
    if (!existsSync(zip))
      throw new Error(
        `${zip} is missing: run \`pnpm --filter @rushwarden/platform-web run package:${portal}\` first`,
      );
    zips.set(portal, new Map(readZip(readFileSync(zip))));
  }
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    // /games/rushwarden/<portal>/<file in the zip>
    const [portal = '', ...rest] = path.startsWith(BASE) ? path.slice(BASE.length).split('/') : [];
    const name = path.startsWith(BASE) ? rest.join('/') || 'index.html' : null;
    const body = name === null ? undefined : zips.get(portal)?.get(name);
    if (name === null || body === undefined) {
      misses.push(path);
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function gameFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => f.url().endsWith('/index.html'))).toBe(true);
  const frame = page.frames().find((f) => f.url().endsWith('/index.html'));
  if (!frame) throw new Error('no game frame');
  return frame;
}

for (const portal of PORTALS)
  test(`the ${portal} zip plays a run with the §9 SDK calls and nothing else`, async ({ page }) => {
    test.setTimeout(180_000);
    misses.length = 0;
    const errors: string[] = [];
    const foreign: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const root = `${origin}${BASE}${portal}/`;
    page.on('request', (r) => {
      const url = r.url();
      if (
        !url.startsWith(root) &&
        url !== SDK_URLS[portal] &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:') &&
        url !== 'about:blank'
      )
        foreign.push(url);
    });
    await page.route(SDK_URLS[portal], (route) =>
      route.fulfill({ contentType: 'text/javascript', body: STUBS[portal] }),
    );
    await page.addInitScript(AUDIO_PROBE);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.setContent(
      `<iframe id="game" src="${root}index.html" width="390" height="844" allowfullscreen></iframe>`,
    );
    const game = page.frameLocator('#game');
    await expect(game.locator('#app')).toHaveAttribute('data-portal', portal);
    await expect(game.locator('.rw-hand .rw-card')).toHaveCount(5);
    const frame = await gameFrame(page);
    const calls = (): Promise<string[]> =>
      frame.evaluate(() => [
        ...((window as unknown as { __sdkCalls?: string[] }).__sdkCalls ?? []),
      ]);

    // Play the whole run with no cards, holding for 2×, skipping every offer.
    const end = game.getByRole('heading', { name: /District held|Run over/ });
    let rounds = 0;
    while (!(await end.isVisible())) {
      await game.getByRole('button', { name: 'Go: start the rush hour' }).click();
      rounds++;
      const map = await game.locator('.rw-map canvas').boundingBox();
      if (!map) throw new Error('no map canvas');
      await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
      await page.mouse.down();
      // The last round shows its own result before the run end ("See the run", playtest U2);
      // the toy hides funds, so skipping reads "Skip" (E4).
      const toEnd = game.getByRole('button', { name: 'See the run' });
      const after = end
        .or(toEnd)
        .or(game.getByRole('button', { name: /^Skip/ }))
        .or(game.getByRole('button', { name: 'Next round' }));
      await expect(after.first()).toBeVisible({ timeout: 60_000 });
      await page.mouse.up();
      if (await toEnd.isVisible()) await toEnd.click();
      if (await end.isVisible()) break;
      const skip = game.getByRole('button', { name: /^Skip/ });
      if (await skip.isVisible()) await skip.click();
      else await game.getByRole('button', { name: 'Next round' }).click();
      await expect(
        end.or(game.getByRole('button', { name: 'Go: start the rush hour' })).first(),
      ).toBeVisible();
    }
    const won = (await end.textContent())?.includes('District held') ?? false;
    const seen = await calls();

    // gameplayStart/Stop around every round, strictly alternating, after the loading event.
    const play = seen.filter((c) => c === 'gameplayStart' || c === 'gameplayStop');
    expect(rounds).toBeGreaterThan(0);
    expect(play).toEqual(
      Array.from({ length: rounds }, () => ['gameplayStart', 'gameplayStop']).flat(),
    );
    const loaded = portal === 'poki' ? 'gameLoadingFinished' : 'loadingStop';
    expect(seen.filter((c) => c === loaded)).toHaveLength(1);
    expect(seen.indexOf(loaded)).toBeLessThan(seen.indexOf('gameplayStart'));
    if (portal === 'crazygames') {
      expect(seen.indexOf('loadingStart')).toBeLessThan(seen.indexOf('loadingStop'));
      expect(seen.filter((c) => c === 'happytime')).toHaveLength(won ? 1 : 0);
    }
    // The share URL comes from the portal's SDK.
    expect(seen).toContain(portal === 'poki' ? 'shareableURL' : 'inviteLink');
    // No ads, ever.
    for (const ad of AD_CALLS) expect(seen, ad).not.toContain(ad);
    // Sound only after a gesture (the toy has no audio yet, so usually none at all).
    const audio = await frame.evaluate(
      () => (window as unknown as { __audioContexts: (boolean | null)[] }).__audioContexts,
    );
    expect(audio.every((gesture) => gesture === true)).toBe(true);

    expect(errors).toEqual([]);
    expect(misses).toEqual([]);
    expect(foreign).toEqual([]);
  });
