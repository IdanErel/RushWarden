/**
 * Steam screenshots from the real run screen at 1920×1080 (P1-QA-03, ADR-029: "Steam screenshots
 * must be real gameplay"). Not a test: run on demand with `pnpm --filter @rushwarden/platform-web
 * run store-shots`, which writes docs/store/screenshots/*.png. CI never runs it (the `store`
 * project exists only with STORE_SHOTS=1).
 *
 * It drives the hooks build like the toy e2e does (H1 seed, H2 state, H3 names, H5 keys). The
 * hooks add no visible element. The sim is seeded, but the moments are taken by wall-clock time,
 * so a re-run gives the same scenes, not byte-identical files.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { SEED_RANGE, noCardRun, type HeadlessRun } from '../toy/headless.js';
import { attr, openToy, pressGo, selectPlayable, skipOffer, state } from '../toy/toy.js';

const OUT = fileURLToPath(new URL('../../../../docs/store/screenshots/', import.meta.url));

/** The Market Day clip's seed (tools/clip MARKET_DAY_SEED): with Roundabout, round 1 still jams. */
const JAM_SEED = 93;

async function shot(page: Page, name: string): Promise<void> {
  // Let the scene draw a few frames after the last state change.
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}steam-run-${name}-1920x1080.png` });
}

/** The lowest seed whose no-card run passes round 1 and gets furthest; a win if there is one. */
function longRun(): HeadlessRun {
  let best: HeadlessRun | null = null;
  const score = (r: HeadlessRun): number =>
    (r.outcome === 'win' ? 100 : 0) + r.rounds.filter((x) => x.pass).length;
  for (let seed = SEED_RANGE.from; seed <= SEED_RANGE.to; seed++) {
    const r = noCardRun(seed);
    if (r.rounds[0]?.mark !== 'pass') continue;
    if (!best || score(r) > score(best)) best = r;
    if (r.outcome === 'win') break;
  }
  if (!best) throw new Error('no seed passes round 1 with no cards');
  return best;
}

test.describe.configure({ timeout: 600_000 });

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test('Market Day: place a card, watch it jam, gridlock', async ({ page }) => {
  await openToy(page, JAM_SEED);
  await selectPlayable(page);
  await page.keyboard.press('ArrowRight'); // ghost preview on a target
  await expect(state(page)).not.toHaveAttribute('data-cursor', '');
  await shot(page, '1-place');

  await page.keyboard.press('Enter');
  await expect(state(page)).not.toHaveAttribute('data-placed', '');
  await pressGo(page);
  await page.waitForTimeout(6_000);
  await shot(page, '2-rush');

  await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 120_000 });
  await shot(page, '3-gridlock');
});

test('a pass, the card offer, the Parade, and the run end', async ({ page }) => {
  const run = longRun();
  await openToy(page, run.seed);
  await pressGo(page);
  await expect(state(page)).toHaveAttribute('data-phase', 'result', { timeout: 120_000 });
  await shot(page, '4-offer');

  await skipOffer(page);
  await expect(state(page)).toHaveAttribute('data-round', '2');
  await pressGo(page);
  // Early: rush demand peaks in the first seconds (CON-05), and the closure is what to show.
  await page.waitForTimeout(2_500);
  await shot(page, '5-parade');

  // The rest of the run at 2× (hold anywhere), no cards, skipping offers.
  await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 120_000 });
  await skipOffer(page);
  while ((await attr(page, 'phase')) === 'place') {
    await pressGo(page);
    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('no map canvas');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 120_000 });
    await page.mouse.up();
    await skipOffer(page);
  }
  await expect(state(page)).toHaveAttribute('data-phase', 'end');
  await shot(page, '6-run-end');
});
