/**
 * The toy e2e (P1-QA-01; docs/release/phase-1-test-plan.md §2.2). Spec IDs match the plan.
 *
 * Where they run (ADR-029):
 * - Fast specs: every PR, in the `web` CI job, on `phone` and `desktop` (`--grep-invert @full`).
 * - Specs tagged `@full` play whole rounds or runs: every PR, in the `toy-e2e` job, on `phone`.
 * - Everything on `phone-webkit`: in the Nightly workflow.
 */
import { expect, test } from '@playwright/test';
import { SEED_RANGE, findSeed, noCardRun, seedTable, type HeadlessRun } from './headless.js';
import {
  GLYPH,
  TARGET,
  TOY_URL,
  attr,
  gameOnly,
  holdRound,
  openToy,
  playNoCards,
  pressGo,
  selectPlayable,
  skipOffer,
  state,
  watchErrors,
  watchRound,
} from './toy.js';

/**
 * The headless run for S1 (`pass-round-1`), S2 (`fail`) or S3 (`gridlock`). When content or sim
 * changes leave no seed in range with that outcome, the spec fails and names it (test plan §2.2):
 * pick a wider range or a scripted play, do not change the expectation.
 */
function need(n: 'pass-round-1' | 'fail' | 'gridlock'): HeadlessRun {
  const run = findSeed(n);
  if (!run)
    throw new Error(`seed finder: no seed in ${SEED_RANGE.from}..${SEED_RANGE.to} gives "${n}"`);
  return run;
}

/** S1: the lowest seed whose first round passes with no cards. */
const passSeed = (): number => need('pass-round-1').seed;

test.describe('toy flow', () => {
  // A 15 s round takes 17–40 s of wall time in headless software WebGL (CI is the slow end).
  test.describe.configure({ timeout: 120_000 });

  // The headless seed scan (S1–S3), once per worker.
  test.beforeAll(() => {
    test.setTimeout(120_000);
    seedTable();
  });

  test('E2E-01 boot to the run screen', async ({ page }) => {
    const errors = watchErrors(page);
    const failed: string[] = [];
    page.on('requestfailed', (r) => failed.push(r.url()));
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    await openToy(page, passSeed());
    await expect(state(page)).toHaveAttribute('data-round', '1');
    await expect(state(page)).toHaveAttribute('data-approval', '3');
    await expect(state(page)).toHaveAttribute('data-energy', '3');
    expect((await attr(page, 'hand')).split(',')).toHaveLength(5);
    await expect(page.getByRole('button', { name: 'Go: start the rush hour' })).toBeVisible();
    // Heat-strips are drawn in the canvas; the readability e2e in packages/render covers them.
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });

  test('E2E-02 place, preview, undo; at most 2 plays', async ({ page }) => {
    await openToy(page, passSeed());
    await selectPlayable(page);
    await page.keyboard.press('ArrowRight'); // move the ghost-preview cursor
    await expect(state(page)).not.toHaveAttribute('data-cursor', '');
    await page.keyboard.press('Enter');
    await expect(state(page)).not.toHaveAttribute('data-placed', '');
    expect(Number(await attr(page, 'energy'))).toBeLessThanOrEqual(3);
    expect((await attr(page, 'hand')).split(',')).toHaveLength(4);
    await page.keyboard.press('Escape'); // undo
    await expect(state(page)).toHaveAttribute('data-placed', '');
    await expect(state(page)).toHaveAttribute('data-energy', '3');
    expect((await attr(page, 'hand')).split(',')).toHaveLength(5);

    // Place until the controller refuses, then every card in hand must have no targets.
    for (let n = 0; n < 2; n++) {
      try {
        await selectPlayable(page);
      } catch {
        break; // out of energy before the second play
      }
      await page.keyboard.press('Enter');
      await expect(state(page)).toHaveAttribute('data-placed', new RegExp(`^[^,]+(,[^,]+){${n}}$`));
    }
    expect((await attr(page, 'placed')).split(',').length).toBeLessThanOrEqual(2);
    const hand = (await attr(page, 'hand')).split(',').filter(Boolean);
    if ((await attr(page, 'placed')).split(',').length === 2)
      for (let i = 0; i < hand.length; i++) {
        await page.keyboard.press(String(i + 1));
        await expect(state(page)).toHaveAttribute('data-selected', String(i));
        expect(await attr(page, 'target-rects'), `card ${i + 1} after two plays`).toBe('[]');
        await page.keyboard.press(String(i + 1));
      }
  });

  test('E2E-03 touch: tap a target, tap again to undo; 44 px controls', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('phone'), 'phone projects only');
    await openToy(page, passSeed());
    await selectPlayable(page);
    const rects = JSON.parse(await attr(page, 'target-rects')) as {
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
    const r = rects.find((x) => x.w < 300) ?? rects[0];
    if (!r) throw new Error('no target rects (H5)');
    const canvas = page.locator('canvas').first();
    const pos = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    await canvas.tap({ position: pos });
    await expect(state(page)).not.toHaveAttribute('data-placed', '');
    if (r.w < 300) {
      await canvas.tap({ position: pos });
      await expect(state(page)).toHaveAttribute('data-placed', '');
    }
    // §7: minimum 44 px touch targets. Measured in one pass in the page, because the hand
    // re-renders while a locator list is being walked.
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((b) => b.checkVisibility())
        .map((b) => ({ b, r: b.getBoundingClientRect() }))
        // On screen only: Pixi's accessibility system parks a 1 px button at -1000 px on touch
        // devices, which nobody can tap.
        .filter(
          ({ r }) => r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
        )
        .filter(({ r }) => Math.min(r.width, r.height) < 44)
        .map(
          ({ b, r }) =>
            `${b.getAttribute('aria-label') ?? b.textContent}: ${Math.round(r.width)}x${Math.round(r.height)}`,
        ),
    );
    expect(small).toEqual([]);
    await pressGo(page);
    await holdRound(page);
  });

  test('E2E-04 Go phase: hold for 2x, release, pause holds the picture', async ({ page }) => {
    // Reduced motion (GDD §8) turns the once-a-second queue pulse (§7) into a steady outline.
    // The pulse keeps running while paused by design, so with full motion a pixel compare
    // catches the pulse, not the sim. With reduced motion, any pixel change while paused means
    // something moved. The game reads the media query at boot, so set it before opening.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openToy(page, passSeed());
    await pressGo(page);
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no map canvas');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(state(page)).toHaveAttribute('data-speed', '2');
    await page.waitForTimeout(1_500);
    await page.mouse.up();
    await expect(state(page)).toHaveAttribute('data-speed', '1');

    await page.keyboard.press('Escape');
    await expect(state(page)).toHaveAttribute('data-paused', 'true');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    // Let the last released tick finish interpolating and the dialog settle, then compare.
    await page.waitForTimeout(500);
    const through = await attr(page, 'throughput');
    const a = await canvas.screenshot();
    await page.waitForTimeout(1_500);
    const b = await canvas.screenshot();
    expect(await attr(page, 'throughput'), 'throughput changed while paused').toBe(through);
    expect(b.equals(a), 'the map moved while paused').toBe(true);
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(state(page)).toHaveAttribute('data-paused', 'false');
    await watchRound(page);
    await expect(state(page)).toHaveAttribute('data-phase', /result|end/);
  });

  test('E2E-05 speed does not change the result', async ({ page }) => {
    test.setTimeout(90_000);
    const seed = passSeed();
    await openToy(page, seed);
    await pressGo(page);
    await watchRound(page); // 1x throughout
    const at1 = await attr(page, 'round-hash');
    const tp1 = await attr(page, 'throughput');
    await openToy(page, seed);
    await pressGo(page);
    await holdRound(page); // 2x throughout
    expect(await attr(page, 'round-hash')).toBe(at1);
    expect(await attr(page, 'throughput')).toBe(tp1);
    expect(at1).toMatch(/^[0-9a-f]{16}$/);
  });

  test('E2E-06 rendered sim equals headless sim', { tag: '@full' }, async ({ page }) => {
    gameOnly('stand-in cards and maps, so headless hashes differ');
    test.setTimeout(240_000);
    const seeds = [need('pass-round-1'), need('fail'), need('gridlock')].map((r) => r.seed);
    for (const seed of new Set(seeds)) {
      await openToy(page, seed);
      const ui = await playNoCards(page);
      const headless = noCardRun(seed).rounds.map((r) => r.hash);
      expect(ui, `seed ${seed}: round hashes, UI vs headless`).toEqual(headless);
    }
  });

  test('E2E-07 pass, then pick an offered card', async ({ page }) => {
    await openToy(page, passSeed());
    await pressGo(page);
    await holdRound(page);
    await expect(state(page)).toHaveAttribute('data-phase', 'result');
    const offers = page.getByRole('button', { name: /^Take / });
    await expect(offers).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Skip, +2 funds' })).toBeVisible();
    await offers.nth(1).click();
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    await expect(state(page)).toHaveAttribute('data-round', '2');
    // "No duplicate of a run-duration card already in the deck" needs the deck, which H2 does
    // not show; the run controller's unit tests (packages/app) cover the rule.
  });

  test('E2E-08 pass, then skip', async ({ page }) => {
    await openToy(page, passSeed());
    await pressGo(page);
    await holdRound(page);
    await expect(state(page)).toHaveAttribute('data-phase', 'result');
    await page.getByRole('button', { name: 'Skip, +2 funds' }).click();
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    await expect(state(page)).toHaveAttribute('data-round', '2');
    await expect(state(page)).toHaveAttribute('data-approval', '3');
  });

  test(
    'E2E-09 a failed round costs approval; zero ends the run',
    { tag: '@full' },
    async ({ page }) => {
      gameOnly('seed outcomes come from the real content');
      test.setTimeout(120_000);
      // A run that ends on approval when the scan met one, else S2. With the content at the time
      // of writing no no-card run loses, so "zero ends the run" is checked only by the run
      // controller's unit tests (packages/app) until one does.
      const run = findSeed('loss') ?? need('fail');
      await openToy(page, run.seed);
      let approval = 3;
      for (const r of run.rounds) {
        await pressGo(page);
        await holdRound(page);
        if (r.mark === 'fail' || (r.gridlocked && !r.pass)) approval--;
        await expect(state(page), `seed ${run.seed} round ${r.round}`).toHaveAttribute(
          'data-approval',
          String(approval),
        );
        await skipOffer(page);
      }
      if (run.outcome === 'loss') {
        await expect(state(page)).toHaveAttribute('data-phase', 'end');
        await expect(state(page)).toHaveAttribute('data-won', 'false');
        await expect(page.getByText('Run over')).toBeVisible();
      }
    },
  );

  test(
    'E2E-10 gridlock ends the round and shows black in the share line',
    { tag: '@full' },
    async ({ page }) => {
      gameOnly('seed outcomes come from the real content');
      test.setTimeout(120_000);
      const run = need('gridlock');
      await openToy(page, run.seed);
      await playNoCards(page);
      const marks = (await attr(page, 'history')).split(',');
      expect(marks, `seed ${run.seed}`).toEqual(run.rounds.map((r) => r.mark));
      const share = (await page.getByLabel('Share text').textContent()) ?? '';
      const glyphs = [...share.matchAll(/[🟩🟨🟥⬛]/gu)].map((m) => m[0]);
      const at = run.rounds.findIndex((r) => r.gridlocked);
      expect(glyphs[at], `seed ${run.seed} round ${at + 1}`).toBe(GLYPH.gridlock);
    },
  );

  test(
    'E2E-11/12/15 full run, share line, retry, and no network',
    { tag: '@full' },
    async ({ page, context, browserName }) => {
      test.setTimeout(150_000);
      const errors = watchErrors(page);
      const origin = new URL(TOY_URL).origin;
      const offsite: string[] = [];
      page.on('request', (r) => {
        if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) offsite.push(r.url());
      });
      const seed = passSeed();
      await openToy(page, seed);
      await playNoCards(page);

      await test.step('E2E-11 run end and share line', async () => {
        await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
        const share = (await page.getByLabel('Share text').textContent()) ?? '';
        expect(share).toMatch(/^Rushwarden · Old Town · [🟩🟨🟥⬛]{5} · \d+ through/u);
        if (TARGET === 'game') {
          const run = noCardRun(seed);
          const strip = run.rounds.map((r) => GLYPH[r.mark]).join('');
          expect(share.startsWith(`Rushwarden · Old Town · ${strip} · ${run.total} through`)).toBe(
            true,
          );
        }
        if (browserName === 'chromium') {
          // Clipboard fallback copies the same text (no Web Share in headless Chromium).
          await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
          await page.getByRole('button', { name: 'Share result' }).click();
          const copied = await page.evaluate(() => navigator.clipboard.readText());
          expect(copied).toBe(share);
        }
      });

      await test.step('E2E-12 retry starts a fresh run without a reload', async () => {
        await page.evaluate(
          () => ((window as unknown as { __noReload: boolean }).__noReload = true),
        );
        await page.getByRole('button', { name: 'Retry' }).click();
        await expect(state(page)).toHaveAttribute('data-phase', 'place');
        await expect(state(page)).toHaveAttribute('data-round', '1');
        await expect(state(page)).toHaveAttribute('data-approval', '3');
        expect((await attr(page, 'hand')).split(',')).toHaveLength(5);
        expect(
          await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
        ).toBe(true);
      });

      await test.step('E2E-15 nothing but same-origin requests (ingest off by default)', async () => {
        expect(offsite).toEqual([]);
      });
      expect(errors).toEqual([]);
    },
  );

  test('E2E-13 portal call pattern (H4 spy)', { tag: '@full' }, async ({ page }) => {
    gameOnly('the dev page has no portal adapter');
    test.setTimeout(240_000);
    const seed = passSeed();
    for (const portal of ['poki', 'crazygames'] as const) {
      await openToy(page, seed, `&portalSpy=${portal}`);
      const rounds = (await playNoCards(page)).length;
      const won = (await attr(page, 'won')) === 'true';
      const calls = (await page.evaluate(() => window.__portalCalls)) ?? [];
      const flow = calls.filter((c) =>
        ['commercialBreak', 'gameplayStart', 'gameplayStop', 'happyTime'].includes(c),
      );
      // §9: commercialBreak before the run and after it; gameplayStart/Stop around every round;
      // happyTime only on a win (where it falls is not specified, so only its count is checked).
      expect(flow[0], `${portal}: first call`).toBe('commercialBreak');
      expect(flow.at(-1), `${portal}: last call`).toBe('commercialBreak');
      const rounds2 = flow.filter((c) => c === 'gameplayStart' || c === 'gameplayStop');
      expect(rounds2, `${portal}: start/stop pairs`).toEqual(
        Array.from({ length: rounds }, () => ['gameplayStart', 'gameplayStop']).flat(),
      );
      expect(flow.filter((c) => c === 'happyTime').length, `${portal}: happyTime`).toBe(
        won ? 1 : 0,
      );
    }
  });

  test('E2E-14 sound only after a gesture', async () => {
    test.fixme(
      true,
      'needs the audio wiring (P1-AUD-01 in the game build); the run screen e2e in packages/ui covers the toggle gesture',
    );
  });

  test('E2E-16 embedded in a 390x844 iframe', async ({ page }) => {
    await page.setContent(
      `<iframe id="game" src="${TOY_URL}/?seed=${passSeed()}" width="390" height="844"
        sandbox="allow-scripts allow-same-origin"></iframe>`,
    );
    const frame = page.frameLocator('#game');
    await frame.locator('#game-state').waitFor({ state: 'attached' });
    await expect(frame.locator('#game-state')).toHaveAttribute('data-phase', 'place');
    const go = frame.getByRole('button', { name: 'Go: start the rush hour' });
    const box = await go.boundingBox();
    const host = await page.locator('#game').boundingBox();
    if (!box || !host) throw new Error('no boxes');
    expect(box.y + box.height, 'Go is inside the 844 px frame').toBeLessThanOrEqual(host.y + 844);
    expect(box.x + box.width).toBeLessThanOrEqual(host.x + 390);
    await go.click();
    await expect(frame.locator('#game-state')).toHaveAttribute('data-phase', 'go');
    // Fullscreen enter/exit is checked on real devices (§3.3 item 7): headless has no fullscreen.
  });

  test('E2E-17 reduced motion', async ({ page }) => {
    // The game reads prefers-reduced-motion once at boot (GDD §8) and reports the mode on H2
    // (`data-reduced-motion`). No shake and no trails in that mode is render's unit test
    // (packages/render effects); this checks the build turns the mode on from the OS setting.
    await openToy(page, passSeed());
    await expect(state(page)).toHaveAttribute('data-reduced-motion', 'false');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openToy(page, passSeed());
    await expect(state(page)).toHaveAttribute('data-reduced-motion', 'true');
    await pressGo(page);
    await expect(state(page)).toHaveAttribute('data-phase', 'go');
    await expect(state(page)).toHaveAttribute('data-reduced-motion', 'true');
  });

  test('E2E-18 landscape desktop fits without clipping', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop project only');
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await openToy(page, passSeed());
      const scroll = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return { h: el.scrollHeight - window.innerHeight, w: el.scrollWidth - window.innerWidth };
      });
      expect(scroll, `${size.width}x${size.height}: page scrolls`).toEqual({ h: 0, w: 0 });
      for (const b of await page.getByRole('button').all()) {
        if (!(await b.isVisible())) continue;
        const box = await b.boundingBox();
        if (!box) continue;
        expect(box.x + box.width, `${await b.textContent()} clipped`).toBeLessThanOrEqual(
          size.width,
        );
        expect(box.y + box.height, `${await b.textContent()} clipped`).toBeLessThanOrEqual(
          size.height,
        );
      }
    }
  });
});
