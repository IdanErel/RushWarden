import { expect, test } from '@playwright/test';

// The public build (no test hooks): the toy's run screen boots with content's cards and the real
// sim worker, and a round plays to its result.
test('web build boots into the run screen and plays a round', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-portal', 'none');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await expect(page.getByText('Round 1/5')).toBeVisible();
  await expect(page.locator('.rw-hand .rw-card')).toHaveCount(5);
  await page.getByRole('button', { name: 'Go: start the rush hour' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Quota met|Quota missed|Gridlock/ })).toBeVisible({
    timeout: 60_000,
  });
  expect(errors).toEqual([]);
});
