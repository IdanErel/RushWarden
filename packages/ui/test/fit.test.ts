import { describe, expect, it } from 'vitest';
import { MAP_MAX_W, MAP_MIN_W, fitMap, mapHeightFor, mapWidthFor } from '../src/fit.js';

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
