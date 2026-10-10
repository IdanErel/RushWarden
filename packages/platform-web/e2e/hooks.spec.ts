import { expect, test } from '@playwright/test';

// Test hooks H1 and H4 (docs/release/phase-1-test-plan.md §2.1). The hooks build runs on the
// public build's port + 1 (4174 by default); the public build must ignore them.
const HOOKS = `http://localhost:${Number(process.env['WEB_E2E_PORT'] ?? '4173') + 1}`;

test('H1: ?seed= fixes the seed in the hooks build', async ({ page }) => {
  await page.goto(`${HOOKS}/?seed=7`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-seed', '7');
  const hash7 = await app.getAttribute('data-hash');
  await page.goto(`${HOOKS}/?seed=8`);
  await expect(app).toHaveAttribute('data-seed', '8');
  expect(await app.getAttribute('data-hash')).not.toBe(hash7);
  await page.goto(`${HOOKS}/?seed=7`);
  await expect(app).toHaveAttribute('data-hash', hash7 ?? '');
});

test('H4: the spy records portal calls in order on window', async ({ page }) => {
  for (const portal of ['poki', 'crazygames'] as const) {
    const external: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith(HOOKS)) external.push(r.url());
    });
    await page.goto(`${HOOKS}/?portalSpy=${portal}`);
    await expect(page.locator('#app')).toHaveAttribute('data-portal', portal);
    const calls = await page.evaluate(() => window.__portalCalls);
    expect(calls?.slice(0, 2)).toEqual(['init', 'loadingFinished']);
    expect(external).toEqual([]);
  }
});

test('public build ignores the hooks', async ({ page }) => {
  await page.goto('/?seed=7&portalSpy=poki');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-seed', '1');
  await expect(app).toHaveAttribute('data-portal', 'none');
  expect(await page.evaluate(() => window.__portalCalls)).toBeUndefined();
});
