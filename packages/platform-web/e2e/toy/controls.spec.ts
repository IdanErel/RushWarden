/**
 * Playtest fixes U2, U3 and U6 (docs: 2026-10-13 triage and plan; Idan's playtest bugs 2 and 3,
 * QA's phone validation). Driven through the hooks only, like the rest of the toy e2e:
 * - U2: the round that ends the run shows its own result first ("See the run" goes on), and a stray
 *   Space or Enter as the board stops never skips it; Space never retries (#96).
 * - U3: Space toggles pause during Go, with "Paused" on screen and the button reading Resume.
 * - U6: "Hold anywhere for 2×" works outside the map too (the phone's empty lower half), but not
 *   on a button.
 */
import { expect, test, type Page } from '@playwright/test';
import { SEED_RANGE, noCardRun, type HeadlessRun } from './headless.js';
import { attr, gameOnly, holdRound, openToy, pressGo, skipOffer, state } from './toy.js';

/** The lowest seed whose no-card run is lost in the fewest rounds (a short, deterministic run). */
let shortLossRun: HeadlessRun | null = null;
function shortLoss(): HeadlessRun {
  if (shortLossRun) return shortLossRun;
  for (let seed = SEED_RANGE.from; seed <= 200; seed++) {
    const r = noCardRun(seed);
    if (r.outcome !== 'loss') continue;
    if (!shortLossRun || r.rounds.length < shortLossRun.rounds.length) shortLossRun = r;
    if (r.rounds.length === 3) break; // 3 approvals: no run is lost sooner
  }
  if (!shortLossRun) throw new Error(`no seed in ${SEED_RANGE.from}..200 loses with no cards`);
  return shortLossRun;
}

const RESULT_TITLE = /^(Quota met|Quota missed|Gridlock)$/;

/** Plays no-card rounds at 2× until the run's last round is in Go. */
async function toLastGo(page: Page, run: HeadlessRun): Promise<void> {
  for (let i = 0; i < run.rounds.length - 1; i++) {
    await pressGo(page);
    await holdRound(page);
    await skipOffer(page);
  }
  await expect(state(page)).toHaveAttribute('data-round', String(run.rounds.length));
  await pressGo(page);
}

/** A point in the run screen that is neither the map nor a control: the panel's empty space. */
async function emptyPanelPoint(page: Page): Promise<{ x: number; y: number }> {
  const map = await page.locator('canvas').first().boundingBox();
  const pause = await page.getByRole('button', { name: /Pause/ }).boundingBox();
  const vp = page.viewportSize();
  if (!map || !pause || !vp) throw new Error('no layout');
  // Phone (portrait): below the Pause button. Desktop (landscape): the right column, below it.
  const below = pause.y + pause.height + 24;
  if (below < vp.height - 8)
    return { x: Math.min(vp.width - 16, pause.x + pause.width / 2), y: below };
  return { x: map.x + map.width + 16, y: pause.y + pause.height / 2 };
}

test.describe('playtest controls', () => {
  test.describe.configure({ timeout: 180_000 });
  test.beforeAll(() => {
    test.setTimeout(120_000);
    shortLoss();
  });

  test('U2 the last round shows its result and stray Space or Enter never retries', async ({
    page,
  }) => {
    gameOnly('seed outcomes come from the real content');
    const run = shortLoss();
    await openToy(page, run.seed);
    await toLastGo(page, run);
    // Idan's bug 2: keys pressed as the board stops. Space, Enter, Space are sent from inside the
    // page on the frame the phase leaves Go, so they land inside the 800 ms key guard however
    // slow the test runner is (an expect poll or a keyboard.press round trip can take longer).
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const tick = (): void => {
            if (document.querySelector('#game-state')?.getAttribute('data-phase') !== 'go') {
              for (const key of [' ', 'Enter', ' '])
                window.dispatchEvent(
                  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
                );
              done();
            } else requestAnimationFrame(tick);
          };
          tick();
        }),
    );
    const last = run.rounds.at(-1);
    if (!last) throw new Error('empty run');
    // The run-ending round's own result is still on screen, with its score.
    await expect(page.getByRole('heading', { name: RESULT_TITLE })).toBeVisible();
    await expect(page.getByRole('dialog').first()).toContainText(
      `${last.throughput} through · quota ${last.quota}`,
    );
    await expect(page.getByRole('button', { name: 'See the run' })).toBeVisible();
    // Past the guard Space may move on to the run end, but it never retries, however long the
    // player keeps pressing it.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(250);
    }
    expect(await attr(page, 'history'), 'the run was not restarted').toBe(
      run.rounds.map((r) => r.mark).join(','),
    );
    await expect(state(page)).toHaveAttribute('data-phase', 'end');

    // The run end; Retry (a click) starts a new run.
    const seeRun = page.getByRole('button', { name: 'See the run' });
    if (await seeRun.isVisible()) await seeRun.click();
    await expect(page.getByRole('heading', { name: 'Run over' })).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry' });
    await page.waitForTimeout(1_000); // past the confirm-key guard
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    await expect(state(page)).toHaveAttribute('data-phase', 'end');
    await retry.click();
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    await expect(state(page)).toHaveAttribute('data-round', '1');
    await expect(state(page)).toHaveAttribute('data-history', '');
  });

  test('U3 Space toggles pause during Go, with Paused shown', async ({ page }) => {
    const run = shortLoss();
    await openToy(page, run.seed);
    await pressGo(page);
    await expect(state(page)).toHaveAttribute('data-paused', 'false');

    await page.keyboard.press('Space');
    await expect(state(page)).toHaveAttribute('data-paused', 'true');
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();
    // Frozen while paused.
    const t0 = await attr(page, 'throughput');
    await page.waitForTimeout(1_500);
    expect(await attr(page, 'throughput')).toBe(t0);
    await expect(state(page)).toHaveAttribute('data-phase', 'go');

    await page.keyboard.press('Space');
    await expect(state(page)).toHaveAttribute('data-paused', 'false');
    await expect(page.getByText('Paused', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();
    // Space still works after the Pause button was clicked (focus left on a button): it must not
    // also fire the focused button, which would toggle twice.
    await page.getByRole('button', { name: /Pause/ }).click();
    await expect(state(page)).toHaveAttribute('data-paused', 'true');
    await page.keyboard.press('Space');
    await expect(state(page)).toHaveAttribute('data-paused', 'false');
    await page.keyboard.press('Space');
    await expect(state(page)).toHaveAttribute('data-paused', 'true');
  });

  test('U6 hold anywhere outside buttons for 2×, not on a button', async ({ page }) => {
    const run = shortLoss();
    await openToy(page, run.seed);
    await pressGo(page);

    const spot = await emptyPanelPoint(page);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await expect(state(page)).toHaveAttribute('data-speed', '2');
    await expect(page.getByText('2× speed')).toBeVisible();
    await page.mouse.up();
    await expect(state(page)).toHaveAttribute('data-speed', '1');

    // On the map, as before.
    const map = await page.locator('canvas').first().boundingBox();
    if (!map) throw new Error('no map canvas');
    await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
    await page.mouse.down();
    await expect(state(page)).toHaveAttribute('data-speed', '2');
    await page.mouse.up();
    await expect(state(page)).toHaveAttribute('data-speed', '1');

    // A press on the Pause button pauses; it does not speed up.
    const pause = await page.getByRole('button', { name: /Pause/ }).boundingBox();
    if (!pause) throw new Error('no Pause button');
    await page.mouse.move(pause.x + pause.width / 2, pause.y + pause.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    expect(await attr(page, 'speed')).toBe('1');
    await page.mouse.up();
  });

  test('U6 touch: a finger held on the empty panel plays at 2× (phone)', async ({
    page,
    browserName,
  }, info) => {
    test.skip(!info.project.name.startsWith('phone'), 'phone projects only');
    test.skip(browserName !== 'chromium', 'touch hold needs CDP touch events (Chromium)');
    const run = shortLoss();
    await openToy(page, run.seed);
    await pressGo(page);
    const cdp = await page.context().newCDPSession(page);
    const spot = await emptyPanelPoint(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [spot] });
    await expect(state(page)).toHaveAttribute('data-speed', '2');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(state(page)).toHaveAttribute('data-speed', '1');
  });
});
