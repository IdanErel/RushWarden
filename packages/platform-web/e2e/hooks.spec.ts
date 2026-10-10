import { expect, test, type Page } from '@playwright/test';

// Test hooks H1 and H4 (docs/release/phase-1-test-plan.md §2.1). The hooks build runs on the
// public build's port + 1 (4174 by default); the public build must ignore them.
const HOOKS = `http://localhost:${Number(process.env['WEB_E2E_PORT'] ?? '4173') + 1}`;
const hand = (page: Page) => page.locator('#game-state').getAttribute('data-hand');

test('H1: ?seed= fixes the run seed in the hooks build', async ({ page }) => {
  await page.goto(`${HOOKS}/?seed=7`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-seed', '7');
  await expect(page.locator('#game-state')).toHaveAttribute('data-hand', /\w/);
  const hand7 = await hand(page);
  await page.goto(`${HOOKS}/?seed=8`);
  await expect(app).toHaveAttribute('data-seed', '8');
  await expect(page.locator('#game-state')).toHaveAttribute('data-hand', /\w/);
  // The same seed deals the same opening hand.
  await page.goto(`${HOOKS}/?seed=7`);
  await expect(page.locator('#game-state')).toHaveAttribute('data-hand', hand7 ?? '');
});

test('H4: the spy records the portal call pattern on window', async ({ page }) => {
  test.setTimeout(180_000);
  for (const portal of ['poki', 'crazygames'] as const) {
    const external: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith(HOOKS)) external.push(r.url());
    });
    await page.goto(`${HOOKS}/?seed=7&portalSpy=${portal}`);
    await expect(page.locator('#app')).toHaveAttribute('data-portal', portal);
    const calls = (): Promise<string[]> => page.evaluate(() => window.__portalCalls ?? []);
    await expect.poll(calls).toContain('commercialBreak');
    const boot = await calls();
    expect(boot[0]).toBe('init');
    // loadingFinished once the run screen is up, then the break before the run (§9).
    expect(boot.indexOf('loadingFinished')).toBeLessThan(boot.indexOf('commercialBreak'));
    expect(boot).not.toContain('gameplayStart');
    // One round: gameplayStart on Go, gameplayStop when it resolves.
    const state = page.locator('#game-state');
    // Go is a no-op until the Pixi scene and the sim worker are up (they start async).
    await expect(page.locator('.rw-map canvas')).toBeVisible();
    await page.keyboard.press(' ');
    await expect(state).toHaveAttribute('data-phase', 'go');
    await expect(state).not.toHaveAttribute('data-phase', 'go', { timeout: 60_000 });
    const round = (await calls()).slice(boot.length);
    expect(round).toEqual(['gameplayStart', 'gameplayStop']);
    expect(external).toEqual([]);
    // Portal builds: no unlock button and no outbound links (GDD §9, ADR-024).
    await expect(page.getByRole('button', { name: /unlock/i })).toHaveCount(0);
    await expect(page.locator('a[href]')).toHaveCount(0);
  }
});

test('public build ignores the hooks', async ({ page }) => {
  await page.goto('/?seed=7&portalSpy=poki');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-portal', 'none');
  await expect(page.locator('.rw-game')).toBeVisible();
  expect(await app.getAttribute('data-seed')).not.toBe('7');
  await expect(page.locator('#game-state')).toHaveCount(0);
  expect(await page.evaluate(() => window.__portalCalls)).toBeUndefined();
});
