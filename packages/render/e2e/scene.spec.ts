import { expect, test } from '@playwright/test';

const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';

test('scene draws the map and interpolated vehicles from the worker', async ({ page }) => {
  test.setTimeout(60_000); // five page loads and screenshots
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?seed=3&ctrl=signal');
  const state = page.locator('#state');
  await expect(state).toHaveAttribute('data-vehicles', /^[1-9]\d*$/, { timeout: 10_000 });
  await expect(page.locator('canvas')).toHaveCount(2);
  // Ticks keep advancing: the worker is stepping. Polled, not a fixed 500 ms wait: a loaded phone
  // runner can skip display frames for longer than that, and the tick only moves on a frame.
  const t0 = Number(await state.getAttribute('data-tick'));
  await expect
    .poll(async () => Number(await state.getAttribute('data-tick')), { timeout: 5_000 })
    .toBeGreaterThan(t0);
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
  // The sim runs the dev page's Smart Signal placement (#32), so its frames show the live phase.
  await expect(state).toHaveAttribute('data-live', /^signal:(ns|ew|):\d+$/);
  // Another controller card: the frames report its kind, and only signals have green sides.
  await page.goto('/?source=sim&seed=6&ctrl=roundabout');
  await expect(state).toHaveAttribute('data-live', /^roundabout::\d+$/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('a District 1 map with the Parade closure runs on the sim', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?source=sim&map=d1-01&boss=parade&seed=4');
  const state = page.locator('#state');
  await expect(state).toHaveAttribute('data-closed', /^[1-9]\d*$/);
  await expect(state).toHaveAttribute('data-vehicles', /^[1-9]\d*$/, { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/ren-03-parade.png` });
  expect(errors).toEqual([]);
});
