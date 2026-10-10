import { expect, test, type Page } from '@playwright/test';

// GDD §4 One-Way: "segment becomes one-way in the chosen direction". The player places it on a
// segment (default direction: west to east or north to south), sees an arrow, and turns it round
// with the ⇄ chip or R. The placement the sim gets carries the chosen from/to (H2
// `data-placed-segments`), and a round runs on the real sim in either direction.

const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';
const state = (page: Page) => page.locator('#game-state');
const attr = async (page: Page, k: string): Promise<string> =>
  (await state(page).getAttribute(`data-${k}`)) ?? '';

/** Opens the dev page on the real sim at the first seed whose round-1 hand holds One-Way. */
async function openWithOneWay(page: Page): Promise<number> {
  for (let seed = 1; seed < 40; seed++) {
    await page.goto(`/?seed=${seed}&source=sim`);
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    const hand = (await attr(page, 'hand')).split(',');
    const i = hand.indexOf('one-way');
    if (i >= 0) return i;
  }
  throw new Error('no seed under 40 deals One-Way');
}

/** `fx,fy>tx,ty` as numbers. */
function parse(seg: string): { from: [number, number]; to: [number, number] } {
  const [a = '', b = ''] = seg.split('>');
  const p = (s: string): [number, number] => {
    const [x = NaN, y = NaN] = s.split(',').map(Number);
    return [x, y];
  };
  return { from: p(a), to: p(b) };
}

/** Selects hand card `i` and taps its first target on the map (the touch path, H5). */
async function placeByTap(page: Page, i: number): Promise<{ x: number; y: number }> {
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await page.keyboard.press(String(i + 1));
  await expect(state(page)).toHaveAttribute('data-selected', String(i));
  await expect(state(page)).not.toHaveAttribute('data-target-rects', '[]');
  const rects = JSON.parse(await attr(page, 'target-rects')) as {
    x: number;
    y: number;
    w: number;
    h: number;
  }[];
  const r = rects[0];
  if (!r) throw new Error('no target rects');
  const position = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  await page.locator('.rw-map canvas').click({ position });
  await expect(state(page)).toHaveAttribute('data-placed', 'one-way');
  return position;
}

/** Goes, holds for 2× and waits for the round to finish on the real sim. */
async function playRound(page: Page): Promise<void> {
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  const box = await page.locator('.rw-map').boundingBox();
  if (!box) throw new Error('no map');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(state(page)).toHaveAttribute('data-phase', /result|end/, { timeout: 30_000 });
  await page.mouse.up();
  expect(await attr(page, 'round-hash')).toMatch(/^[0-9a-f]{16}$/);
}

for (const direction of ['default', 'reversed'] as const) {
  test(`places One-Way in the ${direction} direction and runs the round on it`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const i = await openWithOneWay(page);
    await placeByTap(page, i);

    // Placed on the segment's default direction: west to east, or north to south.
    const placed = await attr(page, 'placed-segments');
    const { from, to } = parse(placed);
    expect(from[0] <= to[0] && from[1] <= to[1] && placed.length > 0).toBe(true);
    const reversed = `${to.join(',')}>${from.join(',')}`;
    const flip = page.getByRole('button', { name: 'Flip One-Way direction' });
    await expect(flip).toBeVisible();

    if (direction === 'reversed') {
      await flip.click();
      await expect(state(page)).toHaveAttribute('data-placed-segments', reversed);
    } else {
      // R turns the last One-Way round, and again turns it back.
      await page.keyboard.press('r');
      await expect(state(page)).toHaveAttribute('data-placed-segments', reversed);
      await page.keyboard.press('r');
      await expect(state(page)).toHaveAttribute('data-placed-segments', placed);
    }
    // Flipping is free: still one play, the same energy (One-Way costs 1).
    await expect(state(page)).toHaveAttribute('data-energy', '2');
    await page.screenshot({ path: `${SHOTS}/one-way-${direction}-${info.project.name}.png` });

    await playRound(page);
    expect(errors).toEqual([]);
  });
}

test('a second tap on a placed One-Way still takes it back (GDD §8)', async ({ page }) => {
  const i = await openWithOneWay(page);
  const position = await placeByTap(page, i);
  await page.getByRole('button', { name: 'Flip One-Way direction' }).click();
  await expect(state(page)).not.toHaveAttribute('data-placed-segments', '');
  await page.locator('.rw-map canvas').click({ position });
  await expect(state(page)).toHaveAttribute('data-placed', '');
  await expect(state(page)).toHaveAttribute('data-energy', '3');
});
