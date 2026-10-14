import { expect, test, type Page } from '@playwright/test';

// P1-AUD-01 wiring (GDD §7 audio, §9 "sound starts after user gesture", ADR-007 audio off by
// default): the real engine on the dev page. H2 `data-audio` is `idle` until an AudioContext
// exists and `started` after; `data-muted` is the toggle. `playCalls` records every play and
// whether the engine actually played it.

const state = (page: Page) => page.locator('#game-state');
type Play = { id: string; played: boolean; t: number };
const plays = (page: Page): Promise<Play[]> =>
  page.evaluate(() => (window as unknown as { playCalls: Play[] }).playCalls);

async function ready(page: Page, url = '/?seed=1'): Promise<void> {
  await page.goto(url);
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(page.locator('.rw-map canvas')).toBeVisible();
}

test('sound is off by default and no audio starts before the player turns it on', async ({
  page,
}) => {
  await ready(page);
  await expect(state(page)).toHaveAttribute('data-muted', 'true');
  await expect(state(page)).toHaveAttribute('data-audio', 'idle');
  // Gestures while muted never start audio.
  await page.keyboard.press('1');
  await expect(state(page)).toHaveAttribute('data-selected', '0');
  await page.locator('.rw-hud').click();
  await expect(state(page)).toHaveAttribute('data-audio', 'idle');
  // The HUD toggle is the gesture that starts it, and the choice is saved.
  const toggle = page.getByRole('button', { name: 'Sound', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(state(page)).toHaveAttribute('data-muted', 'false');
  await expect(state(page)).toHaveAttribute('data-audio', 'started');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('rushwarden.sound'))).toBe('on');

  // A reload restores "on" but waits for a gesture before starting audio.
  await ready(page);
  await expect(state(page)).toHaveAttribute('data-muted', 'false');
  await expect(state(page)).toHaveAttribute('data-audio', 'idle');
  await page.keyboard.press('ArrowRight');
  await expect(state(page)).toHaveAttribute('data-audio', 'started');
  // M mutes (and saves it).
  await page.keyboard.press('m');
  await expect(state(page)).toHaveAttribute('data-muted', 'true');
  expect(await page.evaluate(() => localStorage.getItem('rushwarden.sound'))).toBe('off');
});

test('plays card place, Go, throttled vehicle exits and the round-end sound', async ({ page }) => {
  test.setTimeout(90_000);
  await ready(page);
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect(state(page)).toHaveAttribute('data-audio', 'started');

  // Place the first playable card.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(String(i + 1));
    await expect(state(page)).toHaveAttribute('data-selected', String(i));
    if ((await state(page).getAttribute('data-target-rects')) !== '[]') break;
    await page.keyboard.press(String(i + 1));
  }
  await page.keyboard.press('Enter');
  await expect(state(page)).not.toHaveAttribute('data-placed', '');
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  const box = await page.locator('.rw-map').boundingBox();
  if (!box) throw new Error('no map');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 30_000 });
  await page.mouse.up();

  const p = await plays(page);
  const ids = p.map((c) => c.id);
  expect(p.slice(0, 2)).toMatchObject([
    { id: 'cardPlace', played: true },
    { id: 'go', played: true },
  ]);
  const exits = p.filter((c) => c.id === 'vehicleExit');
  expect(exits.length).toBeGreaterThan(0);
  // Throttled: at least 120 ms between exit sounds however many vehicles leave. `t` is when the
  // screen asked for each sound (the throttle's own clock, `performance.now()`), so the gap is
  // exact up to the timer's coarsening (≤ 0.1 ms in Chromium); 119 leaves 1 ms for that.
  const times = exits.map((c) => c.t);
  times.slice(1).forEach((t, i) => expect(t - (times[i] ?? 0)).toBeGreaterThanOrEqual(119));
  const end = ids[ids.length - 1];
  expect(['quotaPass', 'quotaFail', 'gridlock']).toContain(end);
  const passed = (await state(page).getAttribute('data-history'))?.split(',').at(-1);
  if (passed === 'gridlock') expect(end).toBe('gridlock');
  else expect(end).toBe(passed === 'fail' ? 'quotaFail' : 'quotaPass');
});

test('muted, the screen asks for sounds but the engine plays none', async ({ page }) => {
  await ready(page);
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  expect((await plays(page)).filter((c) => c.played)).toEqual([]);
  await expect(state(page)).toHaveAttribute('data-audio', 'idle');
});

test('blocked storage: sound still toggles, it just is not remembered', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect(state(page)).toHaveAttribute('data-muted', 'false');
  await expect(state(page)).toHaveAttribute('data-audio', 'started');
  expect(errors).toEqual([]);
});
