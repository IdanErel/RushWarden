import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const expected = JSON.parse(
  readFileSync(new URL('../fixtures/hashes.json', import.meta.url), 'utf8'),
) as string[];
const script = readFileSync(new URL('../dist/golden.js', import.meta.url), 'utf8');

test('golden hashes match Node on this engine', async ({ page }) => {
  await page.setContent('<!doctype html><title>golden</title>');
  await page.addScriptTag({ content: script });
  const hashes = await page.evaluate(() =>
    (globalThis as unknown as { runGolden: () => string[] }).runGolden(),
  );
  expect(hashes).toEqual(expected);
});
