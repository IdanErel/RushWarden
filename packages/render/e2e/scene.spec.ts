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
  // Live controller readout (fake controllers frames): a signal with green approaches or all red.
  await expect(state).toHaveAttribute('data-live', /^signal:(ns|ew|):\d+$/);
  for (const ctrl of ['roundabout', 'stop-all', 'priority']) {
    await page.goto(`/?seed=5&ctrl=${ctrl}`);
    await expect(state).toHaveAttribute('data-vehicles', /^[1-9]\d*$/, { timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/ren-01-${ctrl}.png` });
  }
  expect(errors).toEqual([]);
});

test('the real sim drives vehicles and live controller frames through the worker', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?source=sim&seed=6');
  const state = page.locator('#state');
  await expect(state).toHaveAttribute('data-vehicles', /^[1-9]\d*$/, { timeout: 15_000 });
  // Until P1-SIM-05 the sim reports every intersection uncontrolled; the box count still moves.
  await expect(state).toHaveAttribute('data-live', /^uncontrolled::\d+$/);
  expect(errors).toEqual([]);
});
