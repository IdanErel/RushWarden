import { expect, test, type Page } from '@playwright/test';

// P1-UI readability (#81 feel report: "jams can't be traced to a card").
// 1. A gridlock rings the junction where it started and the result card names it.
// 2. Placed-card marks are drawn above the traffic during Go, large enough to read.

const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';
const state = (page: Page) => page.locator('#game-state');
const attr = async (page: Page, k: string): Promise<string> =>
  (await state(page).getAttribute(`data-${k}`)) ?? '';

/** Presses Go and holds the map for 2× until the round ends. */
async function playRound(page: Page): Promise<void> {
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  const box = await page.locator('.rw-map').boundingBox();
  if (!box) throw new Error('no map');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(state(page)).toHaveAttribute('data-phase', /result|end/, { timeout: 45_000 });
  await page.mouse.up();
}

test('a gridlock rings the junction where it started and the result card names it', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  // `jam=1`: the dev page's fake traffic in Gridlock Drill mode, so round 1 gridlocks.
  await page.goto('/?seed=1&jam=1');
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(state(page)).toHaveAttribute('data-gridlock-origin', '');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await playRound(page);
  await expect(page.getByRole('heading', { name: 'Gridlock' })).toBeVisible();

  const origin = await attr(page, 'gridlock-origin');
  expect(origin).toMatch(/^\d,\d$/);
  const [x = 0, y = 0] = origin.split(',').map(Number);
  const ref = `${String.fromCharCode(65 + x)}${y + 1}`;
  await expect(page.getByRole('dialog')).toContainText(
    `It started at the junction ringed in red (${ref})`,
  );
  await page.screenshot({ path: `${SHOTS}/readability-gridlock-${info.project.name}.png` });

  // The next round starts clean.
  const next = page.getByRole('button', { name: /Skip|Next round/ }).first();
  await next.click();
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(state(page)).toHaveAttribute('data-gridlock-origin', '');
});

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  key: string;
}

/** Opens a seed whose hand has a junction card and places it; returns the tile rect it went on. */
async function placeJunctionCard(page: Page): Promise<Rect> {
  for (let seed = 1; seed < 20; seed++) {
    await page.goto(`/?seed=${seed}`);
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    await expect(page.locator('.rw-map canvas')).toBeVisible();
    const hand = (await attr(page, 'hand')).split(',');
    for (let i = 0; i < hand.length; i++) {
      await page.keyboard.press(String(i + 1));
      await expect(state(page)).toHaveAttribute('data-selected', String(i));
      const rects = JSON.parse(await attr(page, 'target-rects')) as Rect[];
      const r = rects.find((t) => t.key.startsWith('intersection:'));
      if (r) {
        await page
          .locator('.rw-map canvas')
          .click({ position: { x: r.x + r.w / 2, y: r.y + r.h / 2 } });
        await expect(state(page)).toHaveAttribute('data-placed', /.+/);
        return r;
      }
      await page.keyboard.press(String(i + 1)); // deselect
    }
  }
  throw new Error('no seed under 20 deals a junction card');
}

/** The colour of the canvas pixel at a CSS-px point, read from a page screenshot. */
async function pixelAt(page: Page, px: number, py: number): Promise<[number, number, number]> {
  const shot = await page.screenshot({ scale: 'css' });
  return page.evaluate(
    async ({ b64, px, py }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      if (!g) return [0, 0, 0] as [number, number, number];
      g.drawImage(img, 0, 0);
      const d = g.getImageData(Math.round(px), Math.round(py), 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0] as [number, number, number];
    },
    { b64: shot.toString('base64'), px, py },
  );
}

test('a placed card’s badge stays on top of the traffic during Go', async ({ page }, info) => {
  test.setTimeout(90_000);
  const r = await placeJunctionCard(page);
  const chip = page.locator('.rw-chip').first();
  const color = await chip.evaluate((el) => getComputedStyle(el).borderTopColor);
  const want = (color.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const canvas = await page.locator('.rw-map canvas').boundingBox();
  if (!canvas) throw new Error('no canvas');
  // The badge: radius max(7, 15% of a tile) at the tile's top-left corner. Sample its coloured
  // ring, between the white centre dot and the dark rim.
  const rad = Math.max(7, r.w * 0.15);
  const bx = canvas.x + r.x + rad + 2 + rad * 0.7;
  const by = canvas.y + r.y + rad + 2;

  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  // Several samples while traffic flows: the badge colour shows in every one.
  for (let k = 0; k < 4; k++) {
    await page.waitForTimeout(700);
    const got = await pixelAt(page, bx, by);
    for (let c = 0; c < 3; c++)
      expect(
        Math.abs((got[c] ?? 0) - (want[c] ?? 0)),
        `sample ${k}: ${got} vs ${want}`,
      ).toBeLessThan(40);
  }
  await page.screenshot({ path: `${SHOTS}/readability-marks-go-${info.project.name}.png` });
});
