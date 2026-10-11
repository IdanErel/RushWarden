import { describe, expect, it } from 'vitest';
import {
  MAP_MAX_W,
  MAP_MIN_W,
  SIDE_MAX_W,
  SIDE_MIN_W,
  WIDE_GAP,
  WIDE_PAD,
  fitMap,
  isWide,
  mapHeightFor,
  mapWidthFor,
  wideLayout,
} from '../src/fit.js';

describe('fitMap', () => {
  it('uses the full width on a tall phone, capped at the column width', () => {
    expect(fitMap(390, 2000)).toEqual({ width: 390, height: mapHeightFor(390) });
    expect(fitMap(1280, 2000).width).toBe(MAP_MAX_W);
  });

  it('shrinks to the height left on a landscape desktop, keeping the 7×9 aspect', () => {
    const { width, height } = fitMap(1280, 420);
    expect(height).toBeLessThanOrEqual(420);
    expect(width).toBe(mapWidthFor(420));
    expect(Math.abs(mapWidthFor(height) - width)).toBeLessThanOrEqual(1);
  });

  it('never goes below the minimum width', () => {
    expect(fitMap(390, 50).width).toBe(MAP_MIN_W);
  });
});

describe('landscape layout (GDD §8 "landscape rearranges HUD to the right")', () => {
  it('is used on landscape desktops and a sideways phone, not on portrait screens', () => {
    expect(isWide(1920, 1080)).toBe(true);
    expect(isWide(1280, 720)).toBe(true);
    expect(isWide(844, 390)).toBe(true);
    expect(isWide(390, 844)).toBe(false);
    expect(isWide(768, 1024)).toBe(false);
    expect(isWide(700, 600)).toBe(false);
  });

  it('grows the upright board to the full height, over 40% of the width', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [1366, 768],
    ] as const) {
      const { side, map } = wideLayout(w, h);
      expect(map.height).toBeLessThanOrEqual(h - 2 * WIDE_PAD);
      expect(map.height).toBeGreaterThanOrEqual(0.9 * h);
      expect(map.width / w).toBeGreaterThanOrEqual(0.4);
      expect(map.width + side + WIDE_GAP + 2 * WIDE_PAD).toBeLessThanOrEqual(w);
      expect(Math.abs(mapWidthFor(map.height) - map.width)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the right column between its bounds, and narrows the board when width runs out', () => {
    expect(wideLayout(1920, 1080).side).toBe(SIDE_MAX_W);
    expect(wideLayout(1280, 720).side).toBe(SIDE_MIN_W);
    const { side, map } = wideLayout(1000, 900);
    expect(map.width + side + WIDE_GAP + 2 * WIDE_PAD).toBeLessThanOrEqual(1000);
    expect(map.height).toBeLessThan(900 - 2 * WIDE_PAD);
  });
});
