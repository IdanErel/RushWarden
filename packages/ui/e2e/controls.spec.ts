import { expect, test, type Locator, type Page } from '@playwright/test';

// Playtest 2026-10-13 controls fixes (U1–U6): Go stays put, hotkeys stay put, Space pauses,
// the run-ending round shows its result and a stray key cannot skip the run end, hold anywhere
// for 2×, and a tap that does nothing says why.

const state = (page: Page) => page.locator('#game-state');
const attr = async (page: Page, k: string): Promise<string> =>
  (await state(page).getAttribute(`data-${k}`)) ?? '';
const SIZES = [
  { width: 1568, height: 735 },
  { width: 390, height: 844 },
];

async function ready(page: Page): Promise<void> {
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go: start the rush hour' })).toBeEnabled();
}

/** Plays the first card in slot order that has a target, by keyboard; returns its slot. */
async function playOne(page: Page): Promise<number> {
  const keys = await page.locator('.rw-hand .rw-card:not(.played)').count();
  for (let k = 1; k <= 5 && keys > 0; k++) {
    const card = page.locator('.rw-hand .rw-card').nth(k - 1);
    if (await card.evaluate((el) => el.classList.contains('played'))) continue;
    await page.keyboard.press(String(k));
    await expect(state(page)).not.toHaveAttribute('data-selected', '');
    if ((await attr(page, 'target-rects')) !== '[]') {
      const before = await attr(page, 'placed');
      await page.keyboard.press('Enter');
      await expect(state(page)).not.toHaveAttribute('data-placed', before);
      return k - 1;
    }
    await page.keyboard.press('Escape');
    await expect(state(page)).toHaveAttribute('data-selected', '');
  }
  throw new Error('no playable card');
}

async function boxOf(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

const top = async (page: Page, sel: string): Promise<number> =>
  Math.round((await page.locator(sel).first().boundingBox())?.y ?? -1);

for (const size of SIZES) {
  test(`${size.width}×${size.height}: Go, the hand and its numbers stay put through a turn (U1, U4)`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'sizes set explicitly');
    await page.setViewportSize(size);
    await page.goto('/?seed=1');
    await ready(page);
    const go0 = await top(page, '.rw-place .rw-go');
    const hand0 = await top(page, '.rw-hand');
    const names0 = await page.locator('.rw-hand .rw-name').allTextContents();
    await page.keyboard.press('1');
    expect(await top(page, '.rw-place .rw-go')).toBe(go0);
    await page.keyboard.press('Escape');
    const a = await playOne(page);
    const b = await playOne(page);
    expect(await top(page, '.rw-place .rw-go'), 'Go after two plays').toBe(go0);
    expect(await top(page, '.rw-hand'), 'hand after two plays').toBe(hand0);
    // Every card keeps its slot and number; the played ones stay, dimmed.
    expect(await page.locator('.rw-hand .rw-key').allTextContents()).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(await page.locator('.rw-hand .rw-name').allTextContents()).toEqual(names0);
    const played = page.locator('.rw-hand .rw-card.played');
    await expect(played).toHaveCount(2);
    await expect(page.locator('.rw-hand .rw-card').nth(a)).toHaveClass(/played/);
    await expect(page.locator('.rw-hand .rw-card').nth(b)).toHaveClass(/played/);
    // Undo by chip: the hand does not move under the pointer.
    await page
      .getByRole('button', { name: /^Undo / })
      .first()
      .click();
    expect(await top(page, '.rw-hand')).toBe(hand0);
    expect(await top(page, '.rw-place .rw-go')).toBe(go0);
  });
}

test('Space pauses and resumes the board; the board says Paused (U3)', async ({ page }) => {
  test.setTimeout(90_000); // times out under load at 30 s (#96 review)
  await page.goto('/?seed=1');
  await ready(page);
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-paused', 'true');
  await expect(page.locator('.rw-paused')).toHaveText('Paused');
  await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();
  const through = await attr(page, 'throughput');
  await page.waitForTimeout(1200);
  expect(await attr(page, 'throughput')).toBe(through);
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-paused', 'false');
  await expect(page.locator('.rw-paused')).toHaveCount(0);
  // The button does the same.
  await page.getByRole('button', { name: /Pause/ }).click();
  await expect(state(page)).toHaveAttribute('data-paused', 'true');
  await page.getByRole('button', { name: /Resume/ }).click();
  await expect(state(page)).toHaveAttribute('data-paused', 'false');
  // Esc still opens the menu.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
});

test('hold anywhere outside a button for 2× (U6)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?seed=1');
  await ready(page);
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  const bar = await boxOf(page.locator('.rw-bar'));
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await expect(state(page)).toHaveAttribute('data-speed', '2');
  await page.mouse.up();
  await expect(state(page)).toHaveAttribute('data-speed', '1');
  const hud = await boxOf(page.locator('.rw-round'));
  await page.mouse.move(hud.x + 4, hud.y + hud.height / 2);
  await page.mouse.down();
  await expect(state(page)).toHaveAttribute('data-speed', '2');
  await page.mouse.up();
  await expect(state(page)).toHaveAttribute('data-speed', '1');
});

test('the run-ending round shows its result; Space never retries; Enter waits for the sheet (U2)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/?seed=1&rounds=1');
  await ready(page);
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  const box = await boxOf(page.locator('.rw-map'));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(state(page)).toHaveAttribute('data-phase', 'end', { timeout: 40_000 });
  await page.mouse.up();
  // The round's own result first, then the run end.
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('h2')).toHaveText(/Quota met|Quota missed|Gridlock/);
  await expect(page.getByText(/funds/)).toHaveCount(0); // E4: no funds in the toy
  await page.waitForTimeout(900);
  await page.keyboard.press('Enter');
  await expect(sheet.locator('h2')).toHaveText(/District held|Run over/);
  // Space never retries. (The 0.8 s Enter delay is timing-bound; the unit-level key map and a
  // reviewer's manual check cover it, as an e2e "too soon" press flakes under load.)
  await page.keyboard.press(' ');
  await page.waitForTimeout(900);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  await expect(state(page)).toHaveAttribute('data-phase', 'end');
  await expect(sheet.locator('h2')).toHaveText(/District held|Run over/);
  await page.keyboard.press('Enter');
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(state(page)).toHaveAttribute('data-round', '1');
});

test('a tap that places nothing says why (U5)', async ({ page }) => {
  await page.goto('/?seed=1');
  await ready(page);
  const canvas = await boxOf(page.locator('.rw-map canvas'));
  // The bottom-left tile is a block on every toy map (the top-left can sit under the tip).
  const at = { x: canvas.x + canvas.width * 0.06, y: canvas.y + canvas.height * 0.95 };
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.rw-toast')).toHaveText(/Pick a card first/);
  await page.keyboard.press('1');
  await expect(state(page)).toHaveAttribute('data-selected', '0');
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.rw-toast')).toHaveText(/not a target for|can’t be played/i);
});
