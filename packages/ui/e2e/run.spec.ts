import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env['SHOT_DIR'] ?? 'test-results/shots';
const state = (page: Page) => page.locator('#game-state');
const attr = async (page: Page, k: string): Promise<string> =>
  (await state(page).getAttribute(`data-${k}`)) ?? '';

/** Selects the first playable hand card by keyboard (H5 path); returns its index. */
async function selectPlayable(page: Page): Promise<number> {
  // H5 target rects come from the Pixi scene, which starts async after the place phase renders:
  // until it is up every card reads `[]` and looks unplayable. Wait for the canvas, and for Go to
  // be enabled, which the screen does only once the scene is set (#50).
  await expect(page.locator('.rw-map canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go: start the rush hour' })).toBeEnabled();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(String(i + 1));
    // Wait for the selection to render before reading its targets (slow machines).
    await expect(state(page)).toHaveAttribute('data-selected', String(i));
    if ((await attr(page, 'target-rects')) !== '[]') return i;
    await page.keyboard.press(String(i + 1)); // deselect
    await expect(state(page)).toHaveAttribute('data-selected', '');
  }
  throw new Error('no playable card');
}

/** Holds the map for 2× until the round leaves the Go phase. */
async function playRoundFast(page: Page): Promise<void> {
  // A hold that starts before Go has rendered is a place-phase tap, not a 2× hold.
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  const box = await page.locator('.rw-map').boundingBox();
  if (!box) throw new Error('no map');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(state(page)).toHaveAttribute('data-speed', '2');
  await expect(state(page)).not.toHaveAttribute('data-phase', 'go', { timeout: 20_000 });
  await page.mouse.up();
}

test('place by keyboard, preview, undo, go, pause, result, offer, run end, share', async ({
  page,
}, info) => {
  test.setTimeout(180_000); // up to 5 rounds of 15 s at 2×
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=1');
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  expect((await attr(page, 'hand')).split(',')).toHaveLength(5);
  expect(await attr(page, 'energy')).toBe('3');

  // Select, move the cursor, place with Enter; Esc undoes.
  const i = await selectPlayable(page);
  expect(await attr(page, 'selected')).toBe(String(i));
  await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: `${SHOTS}/ui-01-place-${info.project.name}.png` });
  await page.keyboard.press('Enter');
  await expect(state(page)).not.toHaveAttribute('data-placed', '');
  await page.keyboard.press('Escape');
  await expect(state(page)).toHaveAttribute('data-placed', '');
  await expect(state(page)).toHaveAttribute('data-energy', '3');
  // Place again and keep it; the chip names the undo action (H3).
  await selectPlayable(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Undo / })).toBeVisible();

  // Go with Space; pause with Esc and resume.
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  await page.keyboard.press('Escape');
  await expect(state(page)).toHaveAttribute('data-paused', 'true');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(state(page)).toHaveAttribute('data-paused', 'false');
  await page.screenshot({ path: `${SHOTS}/ui-01-go-${info.project.name}.png` });
  await playRoundFast(page);

  // Rounds until the run ends: take an offer when there is one, else continue.
  let shotResult = false;
  for (let r = 0; r < 6 && (await attr(page, 'phase')) !== 'end'; r++) {
    await expect(state(page)).toHaveAttribute('data-phase', /result|end/);
    if ((await attr(page, 'phase')) === 'end') break;
    expect(await attr(page, 'round-hash')).toMatch(/^[0-9a-f]{16}$/);
    if (!shotResult) {
      await page.screenshot({ path: `${SHOTS}/ui-01-result-${info.project.name}.png` });
      shotResult = true;
    }
    const take = page.getByRole('button', { name: /^Take / }).first();
    if (await take.isVisible()) {
      await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();
      await take.click();
    } else {
      await page.getByRole('button', { name: 'Next round' }).click();
    }
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    await page.getByRole('button', { name: 'Go: start the rush hour' }).click();
    await playRoundFast(page);
  }
  await expect(state(page)).toHaveAttribute('data-phase', 'end');
  // The run-ending round's own result first (playtest U2), then the run end.
  await page.getByRole('button', { name: 'See the run' }).click();
  const share = await page.getByLabel('Share text').textContent();
  expect(share).toMatch(/^Rushwarden · Old Town · [🟩🟨🟥⬛]+ · \d+ through/u);
  expect([...(share ?? '').matchAll(/[🟩🟨🟥⬛]/gu)].length).toBe(
    (await attr(page, 'history')).split(',').length,
  );
  await expect(page.getByRole('button', { name: 'Share result' })).toBeVisible();
  // The run controller sent its analytics events through the injected track().
  const events = await page.evaluate(() =>
    (window as unknown as { trackCalls: { event: string }[] }).trackCalls.map((c) => c.event),
  );
  expect(events[0]).toBe('run_start');
  expect(events.at(-1)).toBe('run_end');
  expect(events.filter((e) => e === 'round_end')).toHaveLength(
    (await attr(page, 'history')).split(',').length,
  );
  await page.screenshot({ path: `${SHOTS}/ui-01-end-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await expect(state(page)).toHaveAttribute('data-round', '1');
  expect(errors).toEqual([]);
});

test('touch: tap a target from the H5 rects, tap again to undo', async ({ page }) => {
  await page.goto('/?seed=3');
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  await selectPlayable(page);
  const rects = JSON.parse(await attr(page, 'target-rects')) as {
    key: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }[];
  const r = rects[0];
  if (!r) throw new Error('no target rects');
  const canvas = page.locator('.rw-map canvas');
  const pos = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  await canvas.click({ position: pos });
  await expect(state(page)).not.toHaveAttribute('data-placed', '');
  // By key, not size: the fitted map can make the whole-grid district rect small.
  if (r.key !== 'district') {
    // Tile targets undo by tapping them again; district cards undo from their chip.
    await canvas.click({ position: pos });
    await expect(state(page)).toHaveAttribute('data-placed', '');
  }
});

test('privacy panel: switch, install ID, delete my data, sound', async ({ page }, info) => {
  await page.goto('/?seed=1&analytics=1&consent=yes');
  // Already answered: no question.
  await expect(page.getByRole('region', { name: 'Help balance Rushwarden?' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu' }).click();
  // Sound toggle goes through setSoundOnFromGesture inside the click.
  await page.getByRole('button', { name: 'Sound: off' }).click();
  await expect(page.getByRole('button', { name: 'Sound: on' })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { soundCalls: boolean[] }).soundCalls),
  ).toEqual([true]);
  await page.getByRole('button', { name: 'Privacy' }).click();
  const sw = page.getByRole('switch', { name: /Send anonymous gameplay stats/ });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Install ID')).toHaveValue('test-install-0000');
  await expect(page.getByRole('button', { name: 'Copy install ID' })).toBeVisible();
  await expect(page.getByText('Privacy policy: coming soon')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/ui-02-privacy-${info.project.name}.png` });
  // Delete my data: the client's delete, then no ID and the switch off.
  await page.getByRole('button', { name: 'Delete my data' }).click();
  await expect(page.getByRole('status')).toHaveText('Your data was deleted');
  await expect(page.getByLabel('Install ID')).toHaveCount(0);
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  // The switch turns stats back on, and off again.
  await sw.click();
  await expect(page.getByLabel('Install ID')).toHaveValue('test-install-0000');
  await sw.click();
  await expect(page.getByLabel('Install ID')).toHaveCount(0);
  expect(await privacyCalls(page)).toEqual(['delete', 'yes', 'no']);
  // Close goes back to the pause menu.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
});

test('privacy panel: a failed delete says so and keeps the ID for a retry', async ({ page }) => {
  await page.goto('/?seed=1&analytics=1&consent=yes&deleteFail=1');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Privacy' }).click();
  await page.getByRole('button', { name: 'Delete my data' }).click();
  await expect(page.getByRole('status')).toHaveText(/Couldn’t reach the server/);
  await expect(page.getByLabel('Install ID')).toHaveValue('test-install-0000');
  await expect(page.getByText('Your delete request hasn’t gone through yet.')).toBeVisible();
});

test('privacy panel with collection off: nothing to switch, policy link from config', async ({
  page,
}) => {
  await page.goto('/?seed=1&privacy=https%3A%2F%2Fexample.com%2Fprivacy');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Privacy' }).click();
  // Collection off: nothing to switch, no ID.
  await expect(page.getByText('This build collects nothing')).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
    'href',
    'https://example.com/privacy',
  );
});

test('a portal link opener takes the privacy link instead of a new tab (Poki)', async ({
  page,
  context,
}) => {
  await page.goto('/?seed=1&extlink=1&privacy=https%3A%2F%2Fexample.com%2Fprivacy');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Privacy' }).click();
  const pages = context.pages().length;
  await page.getByRole('link', { name: 'Privacy policy' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { linkCalls: string[] }).linkCalls))
    .toEqual(['https://example.com/privacy']);
  expect(context.pages()).toHaveLength(pages);
});

test('Go before the scene is up is held, not dropped', async ({ page }) => {
  await page.goto('/?seed=3');
  // Space as soon as the run screen is mounted, before the Pixi scene and the worker are
  // normally up: the round still starts.
  await state(page).waitFor({ state: 'attached' });
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  await expect(page.getByRole('button', { name: 'Go: start the rush hour' })).toHaveCount(0);
});

const privacyCalls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { privacyCalls: string[] }).privacyCalls);

test('consent panel (ADR-025): non-blocking, equal Yes and No, no answer means no', async ({
  page,
}, info) => {
  await page.goto('/?seed=1&analytics=1');
  const panel = page.getByRole('region', { name: 'Help balance Rushwarden?' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Send anonymous gameplay stats to the developer.');
  const yes = await panel.getByRole('button', { name: 'Yes', exact: true }).boundingBox();
  const no = await panel.getByRole('button', { name: 'No', exact: true }).boundingBox();
  expect(yes && no && [Math.round(yes.width), Math.round(yes.height)]).toEqual(
    no && [Math.round(no.width), Math.round(no.height)],
  );
  expect(
    await panel.getByRole('button', { name: 'Yes', exact: true }).evaluate(
      (y, n) => {
        const a = getComputedStyle(y);
        const b = getComputedStyle(n as Element);
        return (
          [a.backgroundColor, a.color, a.borderColor, a.fontWeight].join() ===
          [b.backgroundColor, b.color, b.borderColor, b.fontWeight].join()
        );
      },
      await panel.getByRole('button', { name: 'No', exact: true }).elementHandle(),
    ),
  ).toBe(true);
  await page.screenshot({ path: `${SHOTS}/ui-02-consent-${info.project.name}.png` });
  // Non-blocking: the run screen still plays while it is up.
  await selectPlayable(page);
  await page.keyboard.press('Enter');
  await expect(state(page)).not.toHaveAttribute('data-placed', '');
  // Its Privacy link opens the panel; Close returns to the run screen with the question still up.
  await panel.getByRole('button', { name: 'Privacy' }).click();
  await expect(page.getByRole('dialog', { name: 'Privacy' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel).toBeVisible();
  // Go without answering: the question goes away and nothing was recorded (no answer = no).
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  await expect(panel).toHaveCount(0);
  expect(await privacyCalls(page)).toEqual([]);

  await page.goto('/?seed=1&analytics=1');
  await panel.getByRole('button', { name: 'No', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(await privacyCalls(page)).toEqual(['no']);
});

test('Poki and CrazyGames builds (ADR-024): no unlock, no links but share and policy', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const policy = 'https://rushwarden.com/privacy';
  const share = 'https://poki.com/en/g/rushwarden';
  for (const portal of ['none', 'poki', 'crazygames']) {
    const q = `?seed=1&rounds=1&portal=${portal}&analytics=1`;
    await page.goto(
      `/${q}&privacy=${encodeURIComponent(policy)}&share=${encodeURIComponent(share)}`,
    );
    await expect(state(page)).toHaveAttribute('data-phase', 'place');
    // Portal builds collect nothing: the consent question never shows, even if passed.
    await expect(page.getByRole('region', { name: 'Help balance Rushwarden?' })).toHaveCount(
      portal === 'none' ? 1 : 0,
    );
    // Go is held until the scene and worker are up; start the round once they are.
    await expect(page.locator('.rw-map canvas')).toBeVisible();
    await page.keyboard.press(' ');
    await playRoundFast(page);
    await expect(state(page)).toHaveAttribute('data-phase', 'end');
    await page.getByRole('button', { name: 'See the run' }).click();
    const won = (await attr(page, 'won')) === 'true';
    const unlock = page.getByRole('button', { name: 'Unlock Districts 2 and 3' });
    await expect(unlock).toHaveCount(portal === 'none' && won ? 1 : 0);
    if (portal === 'none' && won) {
      await unlock.click();
      expect(
        await page.evaluate(() => (window as unknown as { unlockCalls: number[] }).unlockCalls),
      ).toHaveLength(1);
    }
    expect(await page.getByLabel('Share text').textContent()).toContain(share);
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Privacy' }).click();
    if (portal !== 'none')
      await expect(page.getByText('This build collects nothing')).toBeVisible();
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual([policy]);
  }
});

test('live controllers reach the scene during Go (onFrame third argument)', async ({ page }) => {
  await page.goto('/?seed=1');
  await expect(state(page)).toHaveAttribute('data-phase', 'place');
  expect(await attr(page, 'live')).toBe('');
  await page.keyboard.press(' ');
  await expect(state(page)).toHaveAttribute('data-phase', 'go');
  await expect(state(page)).toHaveAttribute('data-live', /^\d+,\d+:\w/);
});

test('H2 reports reduced motion (E2E-17)', async ({ page }) => {
  await page.goto('/?seed=1');
  await expect(state(page)).toHaveAttribute('data-reduced-motion', 'false');
  await page.goto('/?seed=1&reduced=1');
  await expect(state(page)).toHaveAttribute('data-reduced-motion', 'true');
});
