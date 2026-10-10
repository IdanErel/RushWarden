import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { readZip } from '../scripts/zip.mjs';

// P1-PLT-01 smoke test of the artifact itself: the zip `pnpm package:itch` wrote (the exact bytes
// the deploy workflow would upload) is served from a CDN-like subfolder, embedded the way itch
// embeds HTML5 games (a 390×844 cross-origin iframe, GDD §9), and must boot the toy and play a
// round with no errors, no missing files and no request outside its own folder.
const ZIP = join(dirname(fileURLToPath(import.meta.url)), '..', 'itch', 'rushwarden-itch.zip');
const BASE = '/html/1234567/';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

let server: Server;
let origin = '';
const misses: string[] = [];

test.beforeAll(async () => {
  if (!existsSync(ZIP))
    throw new Error(
      `${ZIP} is missing: run \`pnpm --filter @rushwarden/platform-web run package:itch\` first`,
    );
  const files = new Map(readZip(readFileSync(ZIP)));
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const name = path.startsWith(BASE) ? path.slice(BASE.length) || 'index.html' : null;
    const body = name === null ? undefined : files.get(name);
    if (name === null || body === undefined) {
      misses.push(path);
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('the itch zip boots from a subfolder in a 390×844 iframe and plays a round', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(`${origin}${BASE}`) && !url.startsWith('data:') && url !== 'about:blank')
      foreign.push(url);
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.setContent(
    `<iframe id="game" src="${origin}${BASE}index.html" width="390" height="844"
      allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`,
  );
  const game = page.frameLocator('#game');
  await expect(game.locator('#app')).toHaveAttribute('data-portal', 'itch');
  await expect(game.locator('.rw-map canvas')).toBeVisible();
  await expect(game.locator('.rw-hand .rw-card')).toHaveCount(5);
  await game.getByRole('button', { name: 'Go: start the rush hour' }).click();
  await expect(game.getByRole('heading', { name: /Quota met|Quota missed|Gridlock/ })).toBeVisible({
    timeout: 60_000,
  });
  expect(errors).toEqual([]);
  expect(misses).toEqual([]);
  expect(foreign).toEqual([]);
});
