import { expect, test } from '@playwright/test';

const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';

test('scene draws the map and interpolated vehicles from the worker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?seed=3&ctrl=signal');
  const state = page.locator('#state');
  await expect(state).toHaveAttribute('data-vehicles', /^[1-9]\d*$/, { timeout: 10_000 });
  await expect(page.locator('canvas')).toHaveCount(2);
  // Ticks keep advancing: the worker is stepping.
  const t0 = Number(await state.getAttribute('data-tick'));
  await page.waitForTimeout(500);
  expect(Number(await state.getAttribute('data-tick'))).toBeGreaterThan(t0);
  await page.screenshot({ path: `${SHOTS}/ren-01-phone.png` });
  for (const ctrl of ['roundabout', 'stop-all', 'priority']) {
    await page.goto(`/?seed=5&ctrl=${ctrl}`);
    await expect(state).toHaveAttribute('data-vehicles', /^[1-9]\d*$/, { timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/ren-01-${ctrl}.png` });
  }
  expect(errors).toEqual([]);
});

test('the real sim (no vehicles yet) runs through the worker without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?source=sim');
  await expect(page.locator('#state')).toHaveAttribute('data-tick', /^[1-9]\d*$/);
  expect(errors).toEqual([]);
});
