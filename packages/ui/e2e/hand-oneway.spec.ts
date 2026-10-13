import { expect, test, type Page } from '@playwright/test';

// Playtest 2026-10-13: U10 (a 7-card hand fits, keys 6–7) and U11 (One-Way's arrow before it is
// placed, turned round with R or ⇄; "replaces" for a controller over another).

const state = (page: Page) => page.locator('#game-state');
const attr = async (page: Page, k: string): Promise<string> =>
  (await state(page).getAttribute(`data-${k}`)) ?? '';
const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';

async function ready(page: Page): Promise<void> {
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go: start the rush hour' })).toBeEnabled();
}

for (const size of [
  { width: 1568, height: 735 },
  { width: 390, height: 844 },
  { width: 1280, height: 600 },
]) {
  test(`${size.width}×${size.height}: a 7-card hand fits with the board, no scroll (U10)`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'sizes set explicitly');
    await page.setViewportSize(size);
    await page.goto('/?seed=1');
    await ready(page);
    const map5 = await page.locator('.rw-map canvas').boundingBox();
    await page.goto('/?seed=1&hand=7');
    await ready(page);
    const cards = page.locator('.rw-hand .rw-card');
    await expect(cards).toHaveCount(7);
    const scroll = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return [el.scrollHeight - innerHeight, el.scrollWidth - innerWidth];
    });
    expect(scroll).toEqual([0, 0]);
    // Every card is on screen, or (a phone's sideways-scrolling row) comes on screen when picked.
    for (let k = 0; k < 7; k++) {
      await page.keyboard.press(String(k + 1));
      await expect(state(page)).toHaveAttribute('data-selected', String(k));
      await expect(cards.nth(k)).toBeInViewport({ ratio: 0.9 });
      await page.keyboard.press(String(k + 1));
    }
    // The board keeps its 5-card size.
    const map7 = await page.locator('.rw-map canvas').boundingBox();
    expect(map7?.height ?? 0).toBeGreaterThanOrEqual((map5?.height ?? 0) - 8);
    // No name breaks mid-word: every name fits its card.
    // Cards keep at least the 5-card hand's width on a phone (names fit as there: fitNames and
    // soft hyphens), and no name is clipped.
    const over = await page
      .locator('.rw-hand .rw-name')
      .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    expect(over).toBe(0);
    const w7 = (await cards.first().boundingBox())?.width ?? 0;
    expect(w7).toBeGreaterThanOrEqual(60);
    // Keys 6 and 7 select the last two cards.
    await page.keyboard.press('7');
    await expect(state(page)).toHaveAttribute('data-selected', '6');
    await page.keyboard.press('6');
    await expect(state(page)).toHaveAttribute('data-selected', '5');
    await page.screenshot({ path: `${SHOTS}/u10-hand7-${size.width}.png` });
  });
}

test('One-Way shows its arrow before placing; R and ⇄ turn it round first (U11)', async ({
  page,
}, info) => {
  await page.goto('/?seed=1');
  await ready(page);
  const i = (await attr(page, 'hand')).split(',').indexOf('one-way');
  expect(i).toBeGreaterThanOrEqual(0);
  await page.keyboard.press(String(i + 1));
  await expect(state(page)).toHaveAttribute('data-selected', String(i));
  const flip = page.getByRole('button', { name: 'Flip One-Way direction' });
  await expect(flip).toBeVisible();
  await expect(flip).toHaveAttribute('aria-pressed', 'false');
  const canvas = page.locator('.rw-map canvas');
  // Canvas screenshots are slow under the phone's emulated pixel ratio: compare on desktop.
  const desktop = info.project.name === 'desktop';
  const before = desktop ? await canvas.screenshot() : null;
  await page.keyboard.press('r');
  await expect(flip).toHaveAttribute('aria-pressed', 'true');
  if (before) {
    await page.waitForTimeout(200);
    const turned = await canvas.screenshot();
    expect(turned.equals(before), 'the preview arrow turned round').toBe(false);
  }
  await flip.click();
  await expect(flip).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('r');
  // Placed as previewed: reversed against the segment's default.
  await page.keyboard.press('Enter');
  await expect(state(page)).toHaveAttribute('data-placed', 'one-way');
  const seg = await attr(page, 'placed-segments');
  expect(seg).not.toBe('');
});

test('a controller over another this round says it replaces it (U11)', async ({ page }) => {
  // Seed 6: Roundabout and Smart Signal in the opening hand; one junction, (3,4).
  await page.goto('/?seed=6');
  await ready(page);
  const hand = (await attr(page, 'hand')).split(',');
  await page.keyboard.press(String(hand.indexOf('roundabout') + 1));
  await page.keyboard.press('Enter');
  await expect(state(page)).toHaveAttribute('data-placed', 'roundabout');
  // Number keys name the round's slots (U4), so Smart Signal keeps its opening number.
  await page.keyboard.press(String(hand.indexOf('smart-signal') + 1));
  await expect(page.locator('.rw-detail')).toContainText('Replaces your Roundabout here.');
});
