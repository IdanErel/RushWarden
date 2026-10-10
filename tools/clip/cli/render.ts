/**
 * Renders a clip: builds the page, serves it on localhost, drives it frame by frame in headless
 * Chromium, then encodes the PNG frames with ffmpeg. Determinism comes from the page (virtual
 * clock, sim on the page thread, no worker), SwiftShader (software WebGL, so no GPU differences),
 * and ffmpeg run single-threaded with bitexact flags.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { baseName, reproduceArgs, type CliOptions, type Format } from './args.ts';

export const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(PKG_DIR, 'dist');

/** Logical frame (src/hud.ts FRAME_W × FRAME_H). */
const FRAME_W = 432;
const FRAME_H = 768;

export interface ClipOutput {
  readonly name: string;
  /** Absolute paths by format, plus the sidecar. */
  readonly files: Readonly<Partial<Record<Format | 'json', string>>>;
  /** sha256 over every frame's PNG bytes in order: the determinism fingerprint of the pixels. */
  readonly framesSha256: string;
  readonly sha256: Readonly<Partial<Record<Format, string>>>;
  readonly meta: PageMeta;
  readonly width: number;
  readonly height: number;
}

/** What the page's `prepare` returns (src/clip.ts `ClipMeta`), kept loose on this side. */
export interface PageMeta {
  readonly round: number;
  readonly frames: number;
  readonly quota: number;
  readonly cardsPlayed: readonly string[];
  readonly result: {
    readonly throughput: number;
    readonly gridlocked: boolean;
    readonly ticks: number;
    readonly finalHash: string;
  };
  readonly timeline: { readonly fps: number };
  readonly [k: string]: unknown;
}

function run(cmd: string, args: readonly string[], cwd = PKG_DIR): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

export function ffmpegVersion(): string {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0)
    throw new Error(
      'ffmpeg is not on PATH. Install it (Ubuntu: sudo apt-get install -y ffmpeg); CI runners have it.',
    );
  return (r.stdout.split('\n')[0] ?? '').trim();
}

export function buildPage(): void {
  run('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn']);
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

/** Serves `dist/` on 127.0.0.1 at a free port. */
function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
    if (!file.startsWith(DIST + sep) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      ok({ server, url: `http://127.0.0.1:${port}/` });
    }),
  );
}

function sha256(b: Buffer | string): string {
  return createHash('sha256').update(b).digest('hex');
}

function encodeMp4(framesDir: string, fps: number, out: string): void {
  // yuv420p for players and phones; one thread and bitexact so the bytes repeat.
  run('ffmpeg', [
    ...['-y', '-hide_banner', '-loglevel', 'error', '-threads', '1'],
    ...['-framerate', String(fps), '-i', join(framesDir, 'frame-%05d.png')],
    ...['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p'],
    ...['-threads', '1', '-x264-params', 'threads=1:sliced-threads=0'],
    ...['-movflags', '+faststart', '-map_metadata', '-1'],
    ...['-fflags', '+bitexact', '-flags:v', '+bitexact', '-filter_threads', '1'],
    out,
  ]);
}

function encodeGif(
  framesDir: string,
  fps: number,
  gifFps: number,
  width: number,
  out: string,
): void {
  // One palette for the whole clip (flat art, few colours), no dithering: crisp edges, small file.
  const vf =
    `fps=${gifFps},scale=${width}:-2:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=none`;
  run('ffmpeg', [
    ...['-y', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1'],
    ...['-framerate', String(fps), '-i', join(framesDir, 'frame-%05d.png')],
    ...['-vf', vf, '-loop', '0', '-fflags', '+bitexact', '-map_metadata', '-1'],
    out,
  ]);
}

export interface RenderHooks {
  /** Called as frames are written, with the number done so far. */
  readonly progress?: (done: number, total: number) => void;
  /** Skip `vite build` (the page was built already in this process). */
  readonly skipBuild?: boolean;
}

/** The page's API (page/main.ts), as seen from Playwright. */
interface PageApi {
  clip: { prepare(j: unknown): Promise<PageMeta>; frame(i: number): string; seek(i: number): void };
}

const LAUNCH_ARGS = [
  // Software WebGL everywhere, so pixels do not depend on the machine's GPU.
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--force-color-profile=srgb',
];

/** One headless Chromium with the clip page loaded and prepared. */
async function openWorker(
  url: string,
  job: unknown,
): Promise<{
  browser: Browser;
  page: Page;
  meta: PageMeta;
  errors: string[];
}> {
  const executablePath = process.env['PW_CHROMIUM_PATH'];
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: LAUNCH_ARGS,
  });
  const page = await browser.newPage({ viewport: { width: FRAME_W, height: FRAME_H } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForSelector('body[data-ready="1"]', { state: 'attached' });
  const meta = await page.evaluate((j) => (window as unknown as PageApi).clip.prepare(j), job);
  return { browser, page, meta, errors };
}

/** Frame ranges `[start, end)` for `workers` browsers, in order. */
export function chunks(frames: number, workers: number): [number, number][] {
  const n = Math.max(1, Math.min(workers, frames));
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++)
    out.push([Math.floor((frames * k) / n), Math.floor((frames * (k + 1)) / n)]);
  return out;
}

function framePath(dir: string, i: number): string {
  return join(dir, `frame-${String(i + 1).padStart(5, '0')}.png`);
}

/**
 * Renders a clip. Frames are split into contiguous ranges across `workers` browsers; each one
 * fast-forwards its scene to its first frame without drawing (`seek`), so the pixels do not
 * depend on how many workers ran (e2e/clip.spec.ts checks this).
 */
export async function renderClip(
  opts: CliOptions,
  hooks: RenderHooks = {},
  workers = Math.min(4, availableParallelism()),
): Promise<ClipOutput> {
  const ffmpeg = ffmpegVersion();
  if (!hooks.skipBuild) buildPage();
  const { server, url } = await serve();
  const job = {
    spec: opts.spec,
    options: { ...opts.timeline, reducedMotion: opts.reducedMotion },
    scale: opts.scale,
  };
  const width = Math.round(FRAME_W * opts.scale);
  const height = Math.round(FRAME_H * opts.scale);
  const opened: Browser[] = [];
  let framesDir = '';
  try {
    const first = await openWorker(url, job);
    opened.push(first.browser);
    const meta = first.meta;
    const name = opts.name ?? baseName(opts.spec, meta.round);
    mkdirSync(opts.outDir, { recursive: true });
    framesDir = join(opts.outDir, `${name}.frames`);
    rmSync(framesDir, { recursive: true, force: true });
    mkdirSync(framesDir, { recursive: true });

    const ranges = chunks(meta.frames, workers);
    let done = 0;
    const errors: string[] = [];
    await Promise.all(
      ranges.map(async ([start, end], k) => {
        const w = k === 0 ? first : await openWorker(url, job);
        if (k > 0) opened.push(w.browser);
        await w.page.evaluate((i) => (window as unknown as PageApi).clip.seek(i), start);
        for (let i = start; i < end; i++) {
          const dataUrl = await w.page.evaluate(
            (n) => (window as unknown as PageApi).clip.frame(n),
            i,
          );
          writeFileSync(
            framePath(framesDir, i),
            Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'),
          );
          done++;
          if (done % 30 === 0) hooks.progress?.(done, meta.frames);
        }
        errors.push(...w.errors);
      }),
    );
    hooks.progress?.(meta.frames, meta.frames);
    if (errors.length) throw new Error(`clip page errors:\n${errors.join('\n')}`);
    const frameHash = createHash('sha256');
    for (let i = 0; i < meta.frames; i++) frameHash.update(readFileSync(framePath(framesDir, i)));
    const chromiumVersion = first.browser.version();

    const files: Partial<Record<Format | 'json', string>> = {};
    const sums: Partial<Record<Format, string>> = {};
    const fps = meta.timeline.fps;
    if (opts.formats.includes('mp4')) {
      files.mp4 = join(opts.outDir, `${name}.mp4`);
      encodeMp4(framesDir, fps, files.mp4);
      sums.mp4 = sha256(readFileSync(files.mp4));
    }
    if (opts.formats.includes('gif')) {
      files.gif = join(opts.outDir, `${name}.gif`);
      encodeGif(framesDir, fps, Math.min(opts.gifFps, fps), opts.gifWidth, files.gif);
      sums.gif = sha256(readFileSync(files.gif));
    }
    const framesSha256 = frameHash.digest('hex');
    files.json = join(opts.outDir, `${name}.json`);
    const sidecar = {
      ...meta,
      render: {
        width,
        height,
        scale: opts.scale,
        gif: { width: opts.gifWidth, fps: Math.min(opts.gifFps, fps) },
        framesSha256,
        sha256: sums,
        ffmpeg,
        chromium: chromiumVersion,
      },
      reproduce: `pnpm clip ${reproduceArgs(opts, `${name}.json`).join(' ')}`,
    };
    writeFileSync(files.json, `${JSON.stringify(sidecar, null, 2)}\n`);
    return { name, files, framesSha256, sha256: sums, meta, width, height };
  } finally {
    await Promise.all(opened.map((b) => b.close()));
    server.close();
    if (framesDir && !opts.keepFrames) rmSync(framesDir, { recursive: true, force: true });
  }
}
