import { expect, test, type Page } from '@playwright/test';

// GDD §8 "landscape rearranges HUD to the right" (P1-UI-03, E2E-18): on a landscape desktop the
// board sits on the left at full height and the HUD, controls and hand form a right column. The
// board stays upright (7×9), so it is height-bound: at 16:9 it can be at most ~44% of the width.

const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';
const state = (page: Page) => page.locator('#game-state');

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
]) {
  test(`landscape ${size.width}×${size.height}: board left at full height, HUD and hand right`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'landscape sizes run on the desktop project');
    await page.setViewportSize(size);
    await page.goto('/?seed=1');
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    const canvas = page.locator('.rw-map canvas');
    await expect(canvas).toBeVisible();

    // No page scroll in either direction.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.scrollingElement ?? document.documentElement;
          return [el.scrollHeight - innerHeight, el.scrollWidth - innerWidth];
        }),
      )
      .toEqual([0, 0]);

    // The board: at least 40% of the width and 90% of the height.
    const map = await box(page, '.rw-map canvas');
    expect(map.width / size.width, 'map width share').toBeGreaterThanOrEqual(0.4);
    expect(map.height / size.height, 'map height share').toBeGreaterThanOrEqual(0.9);
    expect(map.y).toBeGreaterThanOrEqual(0);
    expect(map.y + map.height).toBeLessThanOrEqual(size.height);

    // The HUD, Go and the whole hand are to the right of the board and on screen.
    const right = map.x + map.width;
    const hud = await box(page, '.rw-hud');
    const go = await box(page, '.rw-go');
    const cards = page.locator('.rw-hand .rw-card');
    await expect(cards).toHaveCount(5);
    const first = await cards.nth(0).boundingBox();
    const last = await cards.nth(4).boundingBox();
    for (const [name, b] of [
      ['HUD', hud],
      ['Go', go],
      ['card 1', first],
      ['card 5', last],
    ] as const) {
      if (!b) throw new Error(`${name} has no box`);
      expect(b.x, `${name} is right of the board`).toBeGreaterThanOrEqual(right);
      expect(b.x + b.width, `${name} fits the width`).toBeLessThanOrEqual(size.width);
      expect(b.y + b.height, `${name} fits the height`).toBeLessThanOrEqual(size.height);
    }
    await page.screenshot({ path: `${SHOTS}/ui-03-landscape-${size.width}x${size.height}.png` });

    // A selected card rises clear of the hint text above it (aef232's note on #56).
    await page.keyboard.press('1');
    await expect(state(page)).toHaveAttribute('data-selected', '0');
    await expect(cards.nth(0)).toHaveClass(/\bsel\b/);
    // Let the 160 ms raise finish.
    await page.waitForTimeout(300);
    const hint = await box(page, '.rw-detail');
    const raised = await cards.nth(0).boundingBox();
    if (!raised) throw new Error('no selected card box');
    expect(raised.y - 3, 'raised card and its ring stay under the hint').toBeGreaterThanOrEqual(
      hint.y + hint.height,
    );
    await page.screenshot({
      path: `${SHOTS}/ui-03-landscape-selected-${size.width}x${size.height}.png`,
    });

    // A tap on a target still lands where it was aimed on the bigger board (H5 rects).
    const rects = JSON.parse((await state(page).getAttribute('data-target-rects')) ?? '[]') as {
      key: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
    const r = rects.find((t) => t.key !== 'district');
    if (r) {
      await canvas.click({ position: { x: r.x + r.w / 2, y: r.y + r.h / 2 } });
      await expect(state(page)).not.toHaveAttribute('data-placed', '');
    }
  });
}

test('landscape: the consent question opens in the right column, not over the board', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?seed=1&analytics=1');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  const panel = page.getByRole('region', { name: 'Help balance Rushwarden?' });
  await expect(panel).toBeVisible();
  const map = await box(page, '.rw-map canvas');
  const b = await panel.boundingBox();
  if (!b) throw new Error('no consent box');
  expect(b.x).toBeGreaterThanOrEqual(map.x + map.width);
  expect(b.x + b.width).toBeLessThanOrEqual(1280);
  await page.screenshot({ path: `${SHOTS}/ui-03-landscape-consent-1280x720.png` });
});

test('portrait phone keeps the column, and the raised card clears the hint', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'portrait runs on the phone project');
  await page.goto('/?seed=1');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await expect(page.locator('.rw-game')).not.toHaveClass(/rw-wide/);
  const map = await box(page, '.rw-map canvas');
  const hand = await box(page, '.rw-hand');
  expect(hand.y).toBeGreaterThanOrEqual(map.y + map.height);
  await page.keyboard.press('1');
  await expect(state(page)).toHaveAttribute('data-selected', '0');
  await page.waitForTimeout(300);
  const hint = await box(page, '.rw-detail');
  const raised = await page.locator('.rw-hand .rw-card').nth(0).boundingBox();
  if (!raised) throw new Error('no selected card box');
  expect(raised.y - 3).toBeGreaterThanOrEqual(hint.y + hint.height);
});

test('turning the window between portrait and landscape re-lays the screen', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?seed=1');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await expect(page.locator('.rw-game')).toHaveClass(/rw-wide/);
  await page.setViewportSize({ width: 430, height: 900 });
  await expect(page.locator('.rw-game')).not.toHaveClass(/rw-wide/);
  await expect.poll(async () => (await box(page, '.rw-map canvas')).width).toBeLessThanOrEqual(430);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.rw-game')).toHaveClass(/rw-wide/);
  await expect
    .poll(async () => (await box(page, '.rw-map canvas')).height / 720)
    .toBeGreaterThanOrEqual(0.9);
});

/** Every hand card's name stays inside its card's padding (no name touches the border). */
async function namesInside(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.rw-hand .rw-card')).flatMap((card) => {
      const name = card.querySelector('.rw-name');
      if (!name) return [];
      const c = card.getBoundingClientRect();
      const n = name.getBoundingClientRect();
      const fits =
        name.scrollWidth <= name.clientWidth + 1 && n.left >= c.left + 4 && n.right <= c.right - 4;
      return fits ? [] : [name.textContent ?? ''];
    }),
  );
}

test('long card names stay inside the card, portrait and landscape (QA #80)', async ({
  page,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1920, height: 1080 });
  // A seed whose first hand holds Roundabout, the longest single-word name.
  let found = false;
  for (let seed = 1; seed < 40 && !found; seed++) {
    await page.goto(`/?seed=${seed}`);
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    found = ((await state(page).getAttribute('data-hand')) ?? '').includes('roundabout');
  }
  expect(found).toBe(true);
  await expect(page.locator('.rw-hand .rw-card')).toHaveCount(5);
  expect(await namesInside(page)).toEqual([]);
});

test('tall landscape: no empty band above the controls, cards show their text (QA #80)', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/?seed=1');
    await expect(page.locator('.rw-map canvas')).toBeVisible();
    await expect(page.locator('.rw-game')).toHaveClass(/rw-roomy/);
    const hud = await box(page, '.rw-hud');
    const controls = await box(page, '.rw-place');
    expect(
      (controls.y - (hud.y + hud.height)) / size.height,
      'band above the controls',
    ).toBeLessThanOrEqual(0.25);
    expect(controls.y + controls.height).toBeLessThanOrEqual(size.height);
    await expect(page.locator('.rw-hand .rw-text').first()).toBeVisible();
  }
  // A short landscape (a phone held sideways) keeps the compact 5-card row.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.rw-game')).not.toHaveClass(/rw-roomy/);
  await expect(page.locator('.rw-hand .rw-text').first()).toBeHidden();
});
