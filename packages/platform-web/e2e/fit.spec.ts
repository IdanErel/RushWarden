import { expect, test } from '@playwright/test';

// GDD §8 / E2E-18: the run screen's column fits the viewport (no page scroll), with the hand and
// Go visible, on the design phone and on common desktop landscape sizes.
for (const size of [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test(`fits ${size.width}×${size.height} without scrolling`, async ({ page }, info) => {
    // The phone size runs on the touch phone project, where Pixi parks its accessibility hook
    // off-screen; the landscape sizes on desktop.
    const want = size.width < 600 ? 'phone' : 'desktop';
    test.skip(info.project.name !== want, `runs on the ${want} project`);
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('.rw-map canvas')).toBeVisible();
    // The map settles after the first layout pass.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.scrollingElement ?? document.documentElement;
          return [el.scrollHeight - innerHeight, el.scrollWidth - innerWidth];
        }),
      )
      .toEqual([0, 0]);
    const go = await page.getByRole('button', { name: 'Go: start the rush hour' }).boundingBox();
    const cards = page.locator('.rw-hand .rw-card');
    await expect(cards).toHaveCount(5);
    const last = await cards.nth(4).boundingBox();
    for (const box of [go, last]) {
      if (!box) throw new Error('Go or the last card has no box');
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    }
  });
}
