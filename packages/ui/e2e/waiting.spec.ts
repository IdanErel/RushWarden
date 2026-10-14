import { expect, test, type Page } from '@playwright/test';

// ADR-035 (QA re-check N1): trips that cannot get on the map wait at their edge, and a road card
// can cut routes off. The board shows the backlog, the result counts it, and the ghost warns.

const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';
const state = (page: Page) => page.locator('#game-state');
const attr = async (page: Page, name: string) =>
  (await state(page).getAttribute(`data-${name}`)) ?? '';

async function ready(page: Page): Promise<void> {
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go: start the rush hour' })).toBeEnabled();
}

const total = (csv: string) => csv.split(',').reduce((n, x) => n + (Number(x) || 0), 0);

test('a jammed round shows a backlog at the edges and counts it on the result', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.goto('/?seed=1&jam=1');
  await ready(page);
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  // Live: per-edge counts arrive with the frames, and the board marks every edge that has any.
  await expect
    .poll(async () => total(await attr(page, 'waiting')), { timeout: 40_000 })
    .toBeGreaterThan(0);
  if (info.project.name === 'desktop')
    await page.locator('.rw-map').screenshot({ path: `${SHOTS}/adr035-backlog.png` });
  await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 40_000 });
  // The fake jam is deterministic: seed 1 ends with 41 trips held at the edges. The board's last
  // frame and the result line agree on it.
  expect(total(await attr(page, 'waiting'))).toBe(41);
  await expect(page.getByRole('dialog')).toContainText(
    '41 vehicles still waiting to enter at the edges.',
  );
});

test('One-Way warns, before it is placed, when it cuts an exit off', async ({ page }, info) => {
  await page.goto('/?seed=1');
  await ready(page);
  const i = (await attr(page, 'hand')).split(',').indexOf('one-way');
  expect(i).toBeGreaterThanOrEqual(0);
  await page.keyboard.press(String(i + 1));
  await expect(state(page)).toHaveAttribute('data-selected', String(i));
  const targets = JSON.parse(await attr(page, 'target-rects')) as unknown[];
  let found = false;
  for (let k = 0; k < targets.length * 2 && !found; k++) {
    if ((await attr(page, 'cut')) !== '') found = true;
    else await page.keyboard.press(k % 2 === 0 ? 'r' : 'ArrowRight');
  }
  expect(found, 'some One-Way placement on the cross cuts a route').toBe(true);
  await expect(page.locator('.rw-detail')).toContainText(
    /Cuts off the (north|east|south|west).* exits?|no way out/,
  );
  if (info.project.name === 'desktop')
    await page.locator('.rw-map').screenshot({ path: `${SHOTS}/adr035-cut.png` });
  // Placing it is still allowed: the warning informs, it does not block.
  await page.keyboard.press('Enter');
  await expect(state(page)).toHaveAttribute('data-placed', 'one-way');
  await expect(state(page)).toHaveAttribute('data-cut', '');
});
