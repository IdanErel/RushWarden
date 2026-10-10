import { describe, expect, it } from 'vitest';
import {
  SCREENSHOTS,
  SHOTS,
  WORDMARK,
  WORDMARK_CHARS,
  coverCrop,
  fitPx,
  shotFrame,
  storeAssets,
  wordmarkOps,
  type ShotFrame,
  type StoreOp,
} from '../src/store.js';

/** Frames as cli/store.ts reports them: 432×768 logical, map box from the page's layout. */
function frames(): Map<string, ShotFrame> {
  return new Map(
    SHOTS.map((s) => [
      s.id,
      {
        id: s.id,
        width: 432 * s.scale,
        height: 768 * s.scale,
        map: { x: 24 * s.scale, y: 140 * s.scale, w: 384 * s.scale, h: 494 * s.scale },
      },
    ]),
  );
}

/** Bounding box of an op, or null for a full-canvas fill. */
function bounds(op: StoreOp): { x0: number; y0: number; x1: number; y1: number } | null {
  if (op.op === 'fill') return null;
  if (op.op === 'image')
    return { x0: op.dst.x, y0: op.dst.y, x1: op.dst.x + op.dst.w, y1: op.dst.y + op.dst.h };
  if (op.op === 'rect') return { x0: op.x, y0: op.y, x1: op.x + op.w, y1: op.y + op.h };
  const pts = op.lines.flat();
  const r = op.width / 2;
  return {
    x0: Math.min(...pts.map((p) => p[0])) - r,
    y0: Math.min(...pts.map((p) => p[1])) - r,
    x1: Math.max(...pts.map((p) => p[0])) + r,
    y1: Math.max(...pts.map((p) => p[1])) + r,
  };
}

describe('store assets', () => {
  const assets = storeAssets(frames());

  it('has every current Steamworks size (ADR-029), six promo images and the itch cover', () => {
    const sizes = assets.map((a) => `${a.store} ${a.width}x${a.height}`);
    for (const s of [
      'steam 920x430',
      'steam 462x174',
      'steam 1232x706',
      'steam 748x896',
      'steam 1438x810',
      'steam 600x900',
      'steam 3840x1240',
      'steam 1280x720',
      'itch 630x500',
    ])
      expect(sizes).toContain(s);
    expect(sizes.filter((s) => s === 'steam 920x430')).toHaveLength(2); // header + library header
    expect(sizes.filter((s) => s === 'promo 1920x1080')).toHaveLength(6);
    // Steam screenshots are gameplay captures from the run screen, not composed here.
    expect(assets.some((a) => a.store === 'steam' && a.width === 1920)).toBe(false);
    expect(new Set(assets.map((a) => a.id)).size).toBe(assets.length);
    for (const a of assets) expect(a.id).toContain(`${a.width}x${a.height}`);
  });

  it('keeps every shape inside its canvas', () => {
    for (const a of assets)
      for (const op of a.ops) {
        const b = bounds(op);
        if (!b) continue;
        expect(b.x0, `${a.id} ${op.op}`).toBeGreaterThanOrEqual(-0.01);
        expect(b.y0, `${a.id} ${op.op}`).toBeGreaterThanOrEqual(-0.01);
        expect(b.x1, `${a.id} ${op.op}`).toBeLessThanOrEqual(a.width + 0.01);
        expect(b.y1, `${a.id} ${op.op}`).toBeLessThanOrEqual(a.height + 0.01);
      }
  });

  it('crops only from inside the grabbed frames', () => {
    const f = frames();
    for (const a of assets)
      for (const op of a.ops) {
        if (op.op !== 'image') continue;
        const fr = f.get(op.shot);
        expect(fr, op.shot).toBeDefined();
        if (!fr) continue;
        expect(op.src.x).toBeGreaterThanOrEqual(0);
        expect(op.src.y).toBeGreaterThanOrEqual(0);
        expect(op.src.x + op.src.w).toBeLessThanOrEqual(fr.width + 0.01);
        expect(op.src.y + op.src.h).toBeLessThanOrEqual(fr.height + 0.01);
        // Same aspect as the slot: nothing is stretched.
        expect(op.src.w / op.src.h).toBeCloseTo(op.dst.w / op.dst.h, 3);
      }
  });

  it('keeps text and logo off the library hero, and the logo transparent', () => {
    const hero = assets.find((a) => a.id.startsWith('steam-library-hero'));
    expect(hero?.ops.map((o) => o.op)).toEqual(['fill', 'image']);
    const bg = assets.find((a) => a.id.startsWith('steam-background'));
    expect(bg?.ops.some((o) => o.op === 'stroke')).toBe(false);
    const logo = assets.find((a) => a.id.startsWith('steam-library-logo'));
    expect(logo?.transparent).toBe(true);
    expect(logo?.ops.some((o) => o.op === 'image')).toBe(false);
  });

  it('names the game on every capsule, screenshot and cover', () => {
    for (const a of assets) {
      if (a.id.startsWith('steam-library-hero') || a.id.startsWith('steam-background')) continue;
      expect(
        a.ops.some((o) => o.op === 'stroke'),
        a.id,
      ).toBe(true);
    }
  });

  it('uses the in-repo font only for characters it has', () => {
    const chars = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ·/:-+.!%×'.split(''));
    for (const s of SCREENSHOTS)
      for (const ch of [...s.caption, s.sub].join('').toUpperCase())
        expect(chars.has(ch), `"${ch}" in "${s.sub}"`).toBe(true);
    for (const ch of WORDMARK) expect(WORDMARK_CHARS).toContain(ch);
  });

  it('fails loudly on a missing frame', () => {
    const f = frames();
    f.delete('jam-hi');
    expect(() => storeAssets(f)).toThrow(/no frame for shot "jam-hi"/);
  });
});

describe('coverCrop', () => {
  it('fills a wide slot from a tall source, centred on the focus, inside the source', () => {
    const c = coverCrop({ x: 10, y: 20, w: 100, h: 200 }, 300, 100, { x: 0.5, y: 0 });
    expect(c.w).toBe(100);
    expect(c.h).toBeCloseTo(100 / 3);
    expect(c.y).toBe(20); // clamped at the top
    const mid = coverCrop({ x: 0, y: 0, w: 100, h: 200 }, 300, 100);
    expect(mid.y + mid.h / 2).toBeCloseTo(100);
  });

  it('fills a tall slot from a wide source', () => {
    const c = coverCrop({ x: 0, y: 0, w: 400, h: 100 }, 1, 2);
    expect(c).toEqual({ x: 175, y: 0, w: 50, h: 100 });
  });
});

describe('wordmark and text helpers', () => {
  it('centres the wordmark in its box and rejects letters it lacks', () => {
    const ops = wordmarkOps({ x: 0, y: 0, w: 1000, h: 1000 }, ['RUSH', 'WARDEN']);
    const xs = ops.flatMap((o) => (o.op === 'stroke' ? o.lines.flat().map((p) => p[0]) : []));
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(1000, 0);
    expect(() => wordmarkOps({ x: 0, y: 0, w: 10, h: 10 }, ['RUSHX'])).toThrow(/no letter "X"/);
  });

  it('fits pixel text to a width', () => {
    expect(fitPx('ABC', 1000, 6)).toBe(6);
    expect(fitPx('ABC', 34, 6)).toBe(2); // 17 px wide at size 1
    expect(fitPx('ABC', 1, 6)).toBe(1);
  });

  it('maps a shot position to a frame index', () => {
    expect(shotFrame({ at: 0 }, 100)).toBe(0);
    expect(shotFrame({ at: 1 }, 100)).toBe(99);
    expect(shotFrame({ at: 0.5 }, 101)).toBe(50);
    expect(shotFrame({ at: 2 }, 10)).toBe(9);
  });
});
