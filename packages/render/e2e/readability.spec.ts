import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';
const num = async (page: Page, key: string): Promise<number> =>
  Number(await page.locator('#state').getAttribute(`data-${key}`));

test('trails and queue pulses show while traffic flows', async ({ page }) => {
  await page.goto('/?seed=4');
  await expect(page.locator('#state')).toHaveAttribute('data-trails', /^[1-9]\d*$/, {
    timeout: 10_000,
  });
  await expect(page.locator('#state')).toHaveAttribute('data-queued', /^[1-9]\d*$/, {
    timeout: 10_000,
  });
  await page.screenshot({ path: `${SHOTS}/ren-02-flow.png` });
});

test('gridlock turns the queue red and rings where it started (jam demo)', async ({ page }) => {
  // 4× so the ~230-tick jam locks up in a few seconds.
  await page.goto('/?seed=2&jam=1&speed=4');
  await expect(page.locator('#state')).toHaveAttribute('data-gridlock', 'true', {
    timeout: 20_000,
  });
  expect(await num(page, 'queued')).toBeGreaterThan(0);
  // The jam demo is the plus map: its one junction is where the jam started.
  await expect(page.locator('#state')).toHaveAttribute('data-gridlock-origin', '3,4');
  await page.waitForTimeout(400); // after the 300 ms shake
  await page.screenshot({ path: `${SHOTS}/ren-02-gridlock.png` });
});

test('reduced motion draws no trails', async ({ page }) => {
  await page.goto('/?seed=4&reduced=1');
  await expect(page.locator('#state')).toHaveAttribute('data-vehicles', /^[1-9]\d*$/, {
    timeout: 10_000,
  });
  for (let i = 0; i < 5; i++) {
    expect(await num(page, 'trails')).toBe(0);
    await page.waitForTimeout(150);
  }
});
