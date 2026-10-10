import { describe, expect, it } from 'vitest';
import { SFX, SFX_IDS, TAG_PITCH, exitPitch } from '../src/sfx';
import { makeVariants, sfxDuration, synthesize } from '../src/synth';

const SR = 22050;
const peak = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('Phase 1 SFX set', () => {
  it('has the five P1-AUD-01 sounds (quota pass and fail as two)', () => {
    expect(SFX_IDS.sort()).toEqual([
      'cardPlace',
      'go',
      'gridlock',
      'quotaFail',
      'quotaPass',
      'vehicleExit',
    ]);
  });

  it.each(SFX_IDS)(
    '%s renders audible, unclipped, short, with 3 distinct seeded variants',
    (id) => {
      const variants = makeVariants(SFX[id], 1);
      expect(variants).toHaveLength(3);
      const rendered = variants.map((d, i) => synthesize(d, SR, 1 + i));
      for (const x of rendered) {
        expect(peak(x)).toBeGreaterThan(0.05);
        expect(peak(x)).toBeLessThan(1); // never hits the clipper
        expect(x.every(Number.isFinite)).toBe(true);
      }
      expect(rendered[0]).not.toEqual(rendered[1]);
      expect(rendered[1]).not.toEqual(rendered[2]);
      expect(sfxDuration(SFX[id])).toBeLessThan(1.2);
    },
  );

  it('vehicle exit is a short pluck so a busy tick stays readable', () => {
    expect(sfxDuration(SFX.vehicleExit)).toBeLessThanOrEqual(0.1);
  });

  it('gridlock is a descending chord plus a thud', () => {
    const tones = SFX.gridlock.voices.filter((v) => v.shape === 'saw');
    expect(tones.length).toBeGreaterThanOrEqual(3);
    expect(tones.every((v) => (v.slide ?? 0) < 0)).toBe(true);
    expect(
      SFX.gridlock.voices.some((v) => v.shape === 'noise' && (v.lowpass ?? Infinity) < 300),
    ).toBe(true);
  });

  it('pitches card place by tag and vehicle exit by score value', () => {
    expect(new Set(Object.values(TAG_PITCH)).size).toBe(5);
    expect([1, 2, 3, 5].map(exitPitch)).toEqual([0, 3, 5, 10]);
    expect(exitPitch(0)).toBe(0);
    expect(exitPitch(99)).toBe(12);
  });
});
