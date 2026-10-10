/**
 * P1-QA-02 acceptance: "Deterministic output from a seed." Renders a short piece of the jam clip
 * (`MARKET_DAY_SEED`, no cards: Market Day gridlocks) twice, with a different number of browsers,
 * and checks the pixels and both encodes are byte-identical, the video is 9:16, and the round the
 * browser rendered is the round Node simulates (same final hash).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { parseArgs } from '../cli/args.ts';
import { buildPage, renderClip } from '../cli/render.ts';
import { buildClip } from '../src/clip.ts';
import { MARKET_DAY_SEED } from '../src/director.ts';

function probe(file: string): { width: number; height: number; frames: number } {
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=width,height,nb_read_frames',
      '-of',
      'csv=p=0',
      file,
    ],
    { encoding: 'utf8' },
  );
  const [width, height, frames] = r.stdout.trim().split(',').map(Number);
  return { width: width ?? 0, height: height ?? 0, frames: frames ?? 0 };
}

test('a seeded clip renders identically twice, at 9:16, from the same round as Node', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-clip-'));
  try {
    // The last ~2 s before the gridlock tick, whatever the seed's round is.
    const jam = buildClip({ seed: MARKET_DAY_SEED, plays: 'none' }).recording.result;
    const from = jam.ticks - 21;
    const argv = [
      '--seed',
      String(MARKET_DAY_SEED),
      '--plays',
      'none',
      '--from',
      String(from),
      '--fps',
      '10',
      '--lead',
      '200',
      '--hold',
      '600',
      '--scale',
      '1',
      '--gif-width',
      '216',
      '--gif-fps',
      '10',
    ];
    const opts = parseArgs(argv, () => null);
    if (!opts) throw new Error('options');
    buildPage();
    const a = await renderClip({ ...opts, outDir: join(dir, 'a') }, { skipBuild: true }, 1);
    const b = await renderClip({ ...opts, outDir: join(dir, 'b') }, { skipBuild: true }, 3);

    expect(b.framesSha256).toBe(a.framesSha256);
    expect(b.sha256.mp4).toBe(a.sha256.mp4);
    expect(b.sha256.gif).toBe(a.sha256.gif);

    const node = buildClip(
      { seed: MARKET_DAY_SEED, plays: 'none' },
      { fromTick: from, fps: 10, leadMs: 200, holdMs: 600 },
    );
    expect(a.meta.result.finalHash).toBe(node.recording.result.finalHash);
    expect(a.meta.result).toMatchObject({ gridlocked: true, ticks: jam.ticks });
    expect(a.meta.frames).toBe(node.frames);

    const mp4 = probe(a.files.mp4 ?? '');
    expect(mp4).toEqual({ width: 432, height: 768, frames: node.frames });
    const gif = probe(a.files.gif ?? '');
    expect(gif.width).toBe(216);
    expect(gif.height).toBe(384);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
