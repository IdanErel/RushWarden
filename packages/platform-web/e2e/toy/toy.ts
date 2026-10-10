/**
 * Helpers for the toy e2e (docs/release/phase-1-test-plan.md §2.2). Specs drive the run screen
 * only through the approved hooks:
 * - H1: `?seed=` in the URL.
 * - H2: the `#game-state` data attributes.
 * - H3: controls found by role and accessible name, never by CSS class.
 * - H4: `window.__portalCalls`.
 * - H5: `data-target-rects` and the keyboard path.
 *
 * Target. By default the specs open the hooks build of this package (`build:e2e`, port 4174 by
 * default), which mounts the run screen (P1-WEB-01). Set `TOY_E2E_URL` to point the same specs at another
 * page with the hooks, such as the run screen's dev page from packages/ui
 * (`TOY_E2E_URL=http://localhost:5175 TOY_E2E_TARGET=ui-dev`). That page uses stand-in cards
 * and fake traffic, so specs that compare against the headless run (or need the H4 spy) skip
 * there and say why.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

/** The hooks build: the public build's port + 1 (4174 unless WEB_E2E_PORT moves it). */
export const TOY_URL =
  process.env['TOY_E2E_URL'] ??
  `http://localhost:${Number(process.env['WEB_E2E_PORT'] ?? '4173') + 1}`;
/** `game` (the platform-web build) or `ui-dev` (packages/ui's dev page, for proving specs). */
export const TARGET = process.env['TOY_E2E_TARGET'] === 'ui-dev' ? 'ui-dev' : 'game';

/** Skips a spec on the ui-dev target, which has stand-in content and no portal spy. */
export function gameOnly(why: string): void {
  test.skip(TARGET !== 'game', `ui-dev page: ${why}`);
}

export const state = (page: Page): Locator => page.locator('#game-state');

export async function attr(page: Page, k: string): Promise<string> {
  return (await state(page).getAttribute(`data-${k}`)) ?? '';
}

/** Page errors and console errors seen since `watch` (E2E-01: "no console errors"). */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Opens the toy at `seed` (H1) and waits for the place phase. */
export async function openToy(page: Page, seed: number, extra = ''): Promise<void> {
  await page.goto(`${TOY_URL}/?seed=${seed}${extra}`);
  await state(page).waitFor({ state: 'attached' });
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  // Target rects and the hold-to-2× surface come from the Pixi scene, which starts async.
  await expect(page.locator('canvas').first()).toBeVisible();
}

/** Selects the first card with valid targets by keyboard (1–5, H5); returns its index. */
export async function selectPlayable(page: Page): Promise<number> {
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(String(i + 1));
    await expect(state(page)).toHaveAttribute('data-selected', String(i));
    if ((await attr(page, 'target-rects')) !== '[]') return i;
    await page.keyboard.press(String(i + 1)); // deselect
    await expect(state(page)).toHaveAttribute('data-selected', '');
  }
  throw new Error('no playable card in hand');
}

export async function pressGo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Go: start the rush hour' }).click();
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
}

/** Waits for the Go phase to end at 1× (a round is 15 s; gridlock ends it sooner). */
export async function watchRound(page: Page): Promise<void> {
  await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 60_000 });
}

/** Holds anywhere on the map for 2× until the round ends (GDD §8 "hold anywhere for 2×"). */
export async function holdRound(page: Page): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no map canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(state(page)).toHaveAttribute('data-speed', '2');
  await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 45_000 });
  await page.mouse.up();
}

/**
 * After a round: skips the offer when there is one, or continues, and waits for the next place
 * phase or the run end.
 */
export async function skipOffer(page: Page): Promise<void> {
  await expect(state(page)).toHaveAttribute('data-phase', /result|end/);
  if ((await attr(page, 'phase')) === 'end') return;
  const skip = page.getByRole('button', { name: 'Skip, +2 funds' });
  if (await skip.isVisible()) await skip.click();
  else await page.getByRole('button', { name: 'Next round' }).click();
  await expect(state(page)).toHaveAttribute('data-phase', /place|end/);
}

/** Plays the whole run with no cards at 2×, skipping offers; returns each round's hash. */
export async function playNoCards(page: Page): Promise<string[]> {
  const hashes: string[] = [];
  while ((await attr(page, 'phase')) === 'place') {
    await pressGo(page);
    await holdRound(page);
    await expect(state(page)).toHaveAttribute('data-phase', /result|end/);
    hashes.push(await attr(page, 'round-hash'));
    await skipOffer(page);
  }
  await expect(state(page)).toHaveAttribute('data-phase', 'end');
  return hashes;
}

/** Share glyphs of the §5 strip, by mark. */
export const GLYPH = { pass: '🟩', near: '🟨', fail: '🟥', gridlock: '⬛' } as const;
