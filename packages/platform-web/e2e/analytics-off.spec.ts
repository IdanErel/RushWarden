import { expect, test } from '@playwright/test';

// ADR-007: analytics stays off in public builds until the privacy policy is published. The default
// build (no VITE_INGEST_URL) must make no request beyond its own static files and must not create
// an install ID.
test('default build sends no analytics and stores no install ID', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await expect(page.locator('#app')).toContainText('sim ok');
  await page.waitForLoadState('networkidle');
  expect(requests.filter((u) => !u.startsWith(baseURL ?? ''))).toEqual([]);
  expect(requests.some((u) => u.includes('/ingest'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('rushwarden.install'))).toBeNull();
});
