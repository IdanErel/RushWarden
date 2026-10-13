import { expect, test, type Page } from '@playwright/test';
import { gameOnly, openToy, playNoCards, state } from './toy/toy.js';

// Playtest S1: no save until Phase 2, so the page asks before it unloads while a run is in
// progress, and not on the end screen. Browsers ask only after the player has interacted, so each
// spec presses a key first. `runBeforeUnload` makes Playwright fire beforeunload on close.

/** Closes the page; returns whether it asked to confirm (the dialog is dismissed, so it stays). */
async function asksOnClose(page: Page): Promise<boolean> {
  let asked = false;
  page.once('dialog', (d) => {
    asked = d.type() === 'beforeunload';
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  // A dismissed beforeunload keeps the page open; give the dialog event time to arrive.
  await expect.poll(() => asked || page.isClosed()).toBe(true);
  return asked;
}

test('asks before leaving a run in progress', async ({ page }) => {
  gameOnly('the leave guard is wired in platform-web main.ts');
  await openToy(page, 1);
  await page.keyboard.press('1'); // user activation
  await expect(state(page)).toHaveAttribute('data-selected', '0');
  expect(await asksOnClose(page)).toBe(true);
  expect(page.isClosed()).toBe(false);
});

test('does not ask on the end screen', { tag: '@full' }, async ({ page }) => {
  gameOnly('the leave guard is wired in platform-web main.ts');
  test.setTimeout(240_000);
  await openToy(page, 1);
  await playNoCards(page);
  await expect(state(page)).toHaveAttribute('data-phase', 'end');
  expect(await asksOnClose(page)).toBe(false);
});
