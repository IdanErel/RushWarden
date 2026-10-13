import { expect, test, type Page } from '@playwright/test';

// Playtest 2026-10-13, information layer: the rules the game has but did not show.

const state = (page: Page) => page.locator('#game-state');

async function ready(page: Page): Promise<void> {
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go: start the rush hour' })).toBeEnabled();
}

async function holdToEnd(page: Page): Promise<void> {
  const box = await page.locator('.rw-map').boundingBox();
  if (!box) throw new Error('no map');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 40_000 });
  await page.mouse.up();
}

test('first-round tip once; rules in the pause menu; the event name in the HUD', async ({
  page,
}) => {
  await page.goto('/?seed=1');
  await ready(page);
  const tip = page.getByRole('region', { name: 'First round.' });
  await expect(tip).toContainText('Play up to 2 cards');
  await expect(tip).toContainText('1 of 3 approval');
  await expect(tip).toContainText('survive 5 rounds');
  await expect(page.locator('.rw-hud')).toContainText('Market Day');
  await tip.getByRole('button', { name: 'Got it' }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await ready(page);
  await expect(tip).toHaveCount(0);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Rules' }).click();
  const rules = page.getByRole('dialog', { name: 'How to play' });
  await expect(rules).toContainText('up to 2 cards');
  await expect(rules).toContainText('15 seconds');
  await expect(rules).toContainText('Orange stripes');
  await expect(rules).toContainText('closed this round');
  await rules.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
});

test('round timer on the bar; the result counts arrivals; the run end has a table and legend', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/?seed=1&rounds=1');
  await ready(page);
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  const timer = page.getByRole('timer');
  await expect(timer).toContainText(/1[0-5] s left/);
  await holdToEnd(page);
  const sheet = page.getByRole('dialog');
  // The run-ending round's result (from the controls PR) or the run end directly.
  const toEnd = page.getByRole('button', { name: 'See the run' });
  if (await toEnd.isVisible()) {
    await expect(sheet).toContainText(/vehicles arrived; \d+ were still on the road/);
    await toEnd.click();
  }
  const table = page.getByRole('table', { name: 'Round by round' });
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText(/\d+ \/ \d+/);
  await expect(sheet).toContainText('🟩 passed · 🟨 passed by under 10% · 🟥 missed · ⬛ gridlock');
});

test('a mid-run result says how many vehicles arrived and how many were left', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?seed=1');
  await ready(page);
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  await holdToEnd(page);
  await expect(page.getByRole('dialog')).toContainText(
    /\d+ vehicles arrived; \d+ were still on the road/,
  );
});
