import { expect, test } from '@playwright/test';

// Portals embed the game in a cross-origin iframe (GDD §9). The host page here is about:blank, so
// the game frame on the preview origin is cross-origin to it, and any access to window.top or
// window.parent from the game would throw and fail the boot.
test('web build boots inside a cross-origin, sandboxed iframe', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent(
    `<iframe id="game" src="${baseURL}/" width="390" height="844"
      sandbox="allow-scripts allow-same-origin"></iframe>`,
  );
  const game = page.frameLocator('#game');
  await expect(game.locator('#app')).toHaveAttribute('data-portal', 'none');
  await expect(game.locator('.rw-map canvas')).toBeVisible();
  await expect(game.getByRole('button', { name: 'Go: start the rush hour' })).toBeVisible();
  expect(errors).toEqual([]);
});
