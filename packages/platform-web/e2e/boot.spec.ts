import { expect, test } from '@playwright/test';

test('web build boots and runs the sim', async ({ page }) => {
  await page.goto('/');
  const app = page.locator('#app');
  await expect(app).toContainText('sim ok');
  await expect(app).toHaveAttribute('data-hash', /^[0-9a-f]{16}$/);
});
