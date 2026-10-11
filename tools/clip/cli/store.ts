/**
 * `pnpm --filter @rushwarden/clip store-assets`: renders the store assets (P1-QA-03) to
 * tools/clip/out/store/: the Steam capsules, library hero and logo, six 1920×1080 screenshots,
 * the itch cover and the Poki/CrazyGames thumbnail and cover, plus `manifest.json` with each
 * file's sha256.
 *
 * Frames come from the clip page, which draws with the game's own `TrafficScene` (ADR-028). The
 * layout is src/store.ts, and page/store.ts draws it on a 2D canvas in the same headless
 * Chromium. This file only moves frames and files.
 *
 * Options: `--out <dir>`; `--only <id,id>` renders only those assets (drafts).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { LAUNCH_ARGS, PKG_DIR, buildPage, openWorker, serve, type PageApi } from './render.ts';

/** The page's store API (page/store.ts), kept loose on this side. */
interface Shot {
  readonly id: string;
  readonly spec: unknown;
  readonly at: number;
  readonly scale: number;
}
interface ShotFrame {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly map: { x: number; y: number; w: number; h: number };
}
interface Composed {
  readonly id: string;
  readonly store: string;
  readonly role: string;
  readonly width: number;
  readonly height: number;
  readonly shots: readonly string[];
  readonly maxUpscale: number | null;
  readonly png: string;
}
interface StoreApi {
  store: {
    shots: readonly Shot[];
    compose(
      frames: readonly ShotFrame[],
      images: Record<string, string>,
      only: readonly string[] | null,
    ): Promise<Composed[]>;
  };
}

/** Logical clip frame (src/hud.ts). */
const FRAME_W = 432;
const FRAME_H = 768;

const cwd = process.env['INIT_CWD'] ?? process.cwd();

function option(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const png = (dataUrl: string): Buffer =>
  Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const outArg = option(argv, '--out');
  const outDir = outArg
    ? isAbsolute(outArg)
      ? outArg
      : resolve(cwd, outArg)
    : join(PKG_DIR, 'out', 'store');
  const only = option(argv, '--only')?.split(',') ?? null;
  const t0 = Date.now();

  buildPage();
  const { server, url } = await serve();
  const executablePath = process.env['PW_CHROMIUM_PATH'];
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: LAUNCH_ARGS,
  });
  try {
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForSelector('body[data-ready="1"]', { state: 'attached' });
    const shots = await page.evaluate(() => (window as unknown as StoreApi).store.shots);

    // One browser per shot: the clip page holds one scene, prepared once.
    const frames: ShotFrame[] = [];
    const images: Record<string, string> = {};
    const shotLog: Record<string, unknown>[] = [];
    for (const shot of shots) {
      const w = await openWorker(url, { spec: shot.spec, options: {}, scale: shot.scale });
      try {
        const n = w.meta.frames;
        const i = Math.round(Math.min(1, Math.max(0, shot.at)) * (n - 1));
        await w.page.evaluate((k) => (window as unknown as PageApi).clip.seek(k), i);
        images[shot.id] = await w.page.evaluate(
          (k) => (window as unknown as PageApi).clip.frame(k),
          i,
        );
        const b = await w.page.evaluate(() => (window as unknown as PageApi).clip.layout());
        if (w.errors.length) throw new Error(`clip page errors:\n${w.errors.join('\n')}`);
        const s = shot.scale;
        frames.push({
          id: shot.id,
          width: Math.round(FRAME_W * s),
          height: Math.round(FRAME_H * s),
          map: { x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s },
        });
        shotLog.push({ id: shot.id, spec: shot.spec, frame: i, of: n, scale: s });
        console.log(`shot ${shot.id.padEnd(8)} frame ${i} of ${n}, scale ${s}`);
      } finally {
        await w.browser.close();
      }
    }

    const composed = await page.evaluate(
      ([f, im, o]) => (window as unknown as StoreApi).store.compose(f, im, o),
      [frames, images, only] as const,
    );
    mkdirSync(outDir, { recursive: true });
    const manifest = composed.map(({ png: dataUrl, ...a }) => {
      const bytes = png(dataUrl);
      const file = join(outDir, `${a.id}.png`);
      writeFileSync(file, bytes);
      console.log(`${a.id.padEnd(36)} ${relative(cwd, file)}`);
      return { ...a, bytes: bytes.length, sha256: sha256(bytes) };
    });
    writeFileSync(
      join(outDir, 'manifest.json'),
      `${JSON.stringify(
        {
          tool: 'rushwarden-store-assets',
          chromium: browser.version(),
          reproduce: 'pnpm --filter @rushwarden/clip store-assets',
          shots: shotLog,
          assets: manifest,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`${manifest.length} assets in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
