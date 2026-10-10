import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';
const state = (page: Page) => page.locator('#game-state');
const attr = async (page: Page, k: string): Promise<string> =>
  (await state(page).getAttribute(`data-${k}`)) ?? '';

/** Selects the first playable hand card by keyboard (H5 path); returns its index. */
async function selectPlayable(page: Page): Promise<number> {
  // Target rects come from the Pixi scene, which starts asynchronously: wait for its canvas.
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(String(i + 1));
    // Wait for the selection to render before reading its targets (slow machines).
    await expect(state(page)).toHaveAttribute('data-selected', String(i));
    if ((await attr(page, 'target-rects')) !== '[]') return i;
    await page.keyboard.press(String(i + 1)); // deselect
    await expect(state(page)).toHaveAttribute('data-selected', '');
  }
  throw new Error('no playable card');
}

/** Holds the map for 2× until the round leaves the Go phase. */
async function playRoundFast(page: Page): Promise<void> {
  const box = await page.locator('.rw-map').boundingBox();
  if (!box) throw new Error('no map');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(state(page)).toHaveAttribute('data-speed', '2');
  await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 20_000 });
  await page.mouse.up();
}

test('place by keyboard, preview, undo, go, pause, result, offer, run end, share', async ({
  page,
}, info) => {
  test.setTimeout(180_000); // up to 5 rounds of 15 s at 2×
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=1');
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  expect((await attr(page, 'hand')).split(',')).toHaveLength(5);
  expect(await attr(page, 'energy')).toBe('3');

  // Select, move the cursor, place with Enter; Esc undoes.
  const i = await selectPlayable(page);
  expect(await attr(page, 'selected')).toBe(String(i));
  await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: `${SHOTS}/ui-01-place-${info.project.name}.png` });
  await page.keyboard.press('Enter');
  await expect(state(page)).not.toHaveAttribute('data-placed', '');
  await page.keyboard.press('Escape');
  await expect(state(page)).toHaveAttribute('data-placed', '');
  await expect(state(page)).toHaveAttribute('data-energy', '3');
  // Place again and keep it; the chip names the undo action (H3).
  await selectPlayable(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Undo / })).toBeVisible();

  // Go with Space; pause with Esc and resume.
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  await page.keyboard.press('Escape');
  await expect(state(page)).toHaveAttribute('data-paused', 'true');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(state(page)).toHaveAttribute('data-paused', 'false');
  await page.screenshot({ path: `${SHOTS}/ui-01-go-${info.project.name}.png` });
  await playRoundFast(page);

  // Rounds until the run ends: take an offer when there is one, else continue.
  let shotResult = false;
  for (let r = 0; r < 6 && (await attr(page, 'phase')) !== 'end'; r++) {
    await expect(state(page)).toHaveAttribute('data-phase', /result|end/);
    if ((await attr(page, 'phase')) === 'end') break;
    expect(await attr(page, 'round-hash')).toMatch(/^[0-9a-f]{16}$/);
    if (!shotResult) {
      await page.screenshot({ path: `${SHOTS}/ui-01-result-${info.project.name}.png` });
      shotResult = true;
    }
    const take = page.getByRole('button', { name: /^Take / }).first();
    if (await take.isVisible()) {
      await expect(page.getByRole('button', { name: 'Skip, +2 funds' })).toBeVisible();
      await take.click();
    } else {
      await page.getByRole('button', { name: 'Next round' }).click();
    }
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    await page.getByRole('button', { name: 'Go: start the rush hour' }).click();
    await playRoundFast(page);
  }
  await expect(state(page)).toHaveAttribute('data-phase', 'end');
  const share = await page.getByLabel('Share text').textContent();
  expect(share).toMatch(/^Rushwarden · Old Town · [🟩🟨🟥⬛]+ · \d+ through/u);
  expect([...(share ?? '').matchAll(/[🟩🟨🟥⬛]/gu)].length).toBe(
    (await attr(page, 'history')).split(',').length,
  );
  await expect(page.getByRole('button', { name: 'Share result' })).toBeVisible();
  // The run controller sent its analytics events through the injected track().
  const events = await page.evaluate(() =>
    (window as unknown as { trackCalls: { event: string }[] }).trackCalls.map((c) => c.event),
  );
  expect(events[0]).toBe('run_start');
  expect(events.at(-1)).toBe('run_end');
  expect(events.filter((e) => e === 'round_end')).toHaveLength(
    (await attr(page, 'history')).split(',').length,
  );
  await page.screenshot({ path: `${SHOTS}/ui-01-end-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(state(page)).toHaveAttribute('data-round', '1');
  expect(errors).toEqual([]);
});

test('touch: tap a target from the H5 rects, tap again to undo', async ({ page }) => {
  await page.goto('/?seed=3');
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await selectPlayable(page);
  const rects = JSON.parse(await attr(page, 'target-rects')) as {
    x: number;
    y: number;
    w: number;
    h: number;
  }[];
  const r = rects[0];
  if (!r) throw new Error('no target rects');
  const canvas = page.locator('.rw-map canvas');
  const pos = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  await canvas.click({ position: pos });
  await expect(state(page)).not.toHaveAttribute('data-placed', '');
  if (r.w < 300) {
    // Tile targets undo by tapping them again; district cards undo from their chip.
    await canvas.click({ position: pos });
    await expect(state(page)).toHaveAttribute('data-placed', '');
  }
});

test('about and privacy: install ID to copy, policy link from config, sound toggle', async ({
  page,
}, info) => {
  await page.goto('/?seed=1');
  await page.getByRole('button', { name: 'Menu' }).click();
  // Sound toggle goes through setSoundOnFromGesture inside the click.
  await page.getByRole('button', { name: 'Sound: off' }).click();
  await expect(page.getByRole('button', { name: 'Sound: on' })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { soundCalls: boolean[] }).soundCalls),
  ).toEqual([true]);
  await page.getByRole('button', { name: 'About and privacy' }).click();
  await expect(page.getByLabel('Install ID')).toHaveValue('test-install-0000');
  await expect(page.getByRole('button', { name: 'Copy install ID' })).toBeVisible();
  await expect(page.getByText('Privacy policy: coming soon')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/ui-01-about-${info.project.name}.png` });
  await page.goto('/?seed=1&privacy=https%3A%2F%2Fexample.com%2Fprivacy');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'About and privacy' }).click();
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
    'href',
    'https://example.com/privacy',
  );
});

test('Go before the scene is up is held, not dropped', async ({ page }) => {
  await page.goto('/?seed=3');
  // Space as soon as the run screen is mounted, before the Pixi scene and the worker are
  // normally up: the round still starts.
  await state(page).waitFor({ state: 'attached' });
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  await expect(page.getByRole('button', { name: 'Go: start the rush hour' })).toHaveCount(0);
});
