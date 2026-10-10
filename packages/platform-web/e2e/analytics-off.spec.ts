import { expect, test } from '@playwright/test';

// ADR-007, ADR-025: analytics stays off in public builds until the privacy policy is published,
// and off until the player says yes even then. The default build (no VITE_INGEST_URL) must make no
// request beyond its own static files and must not create an install ID, through a whole round.
test('default build sends no analytics and stores no install ID', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await page.getByRole('button', { name: 'Go: start the rush hour' }).click();
  await expect(page.getByRole('heading', { name: /Quota met|Quota missed|Gridlock/ })).toBeVisible({
    timeout: 40_000,
  });
  await page.waitForLoadState('networkidle');
  expect(requests.filter((u) => !u.startsWith(baseURL ?? ''))).toEqual([]);
  expect(requests.some((u) => u.includes('/ingest'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('rushwarden.install'))).toBeNull();
});
