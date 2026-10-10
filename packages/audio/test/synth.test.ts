import { describe, expect, it } from 'vitest';
import {
  envelope,
  makeVariants,
  sfxDuration,
  synthesize,
  voiceDuration,
  type SfxDef,
  type Voice,
} from '../src/synth.js';
import { hashString, rng } from '../src/rng.js';

const SR = 8000;

/** Counts upward zero crossings, i.e. cycles, in a sample window. */
function cycles(x: Float32Array, from = 0, to = x.length): number {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1]! < 0 && x[i]! >= 0) n++;
  return n;
}

const tone = (v: Partial<Voice> = {}): SfxDef => ({
  voices: [{ shape: 'sine', freq: 440, sustain: 1, ...v }],
});

describe('rng', () => {
  it('is seeded, in [0, 1), and differs across seeds', () => {
    const a = rng(42);
    const b = rng(42);
    const xs = Array.from({ length: 100 }, () => a());
    expect(xs).toEqual(Array.from({ length: 100 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rng(43)()).not.toBe(xs[0]);
  });
  it('hashString is stable', () => {
    expect(hashString('go')).toBe(hashString('go'));
    expect(hashString('go')).not.toBe(hashString('gridlock'));
  });
});

describe('envelope', () => {
  const v: Voice = {
    shape: 'sine',
    freq: 1,
    attack: 0.1,
    decay: 0.1,
    sustain: 0.2,
    release: 0.1,
    sustainLevel: 0.5,
  };
  it('follows attack, decay, sustain, release', () => {
    expect(envelope(v, -1)).toBe(0);
    expect(envelope(v, 0.05)).toBeCloseTo(0.5);
    expect(envelope(v, 0.15)).toBeCloseTo(0.75);
    expect(envelope(v, 0.3)).toBe(0.5);
    expect(envelope(v, 0.45)).toBeCloseTo(0.25);
    expect(envelope(v, 0.6)).toBe(0);
    expect(voiceDuration({ ...v, delay: 0.5 })).toBeCloseTo(1);
  });
});

describe('synthesize', () => {
  it('renders the right length and stays within [-1, 1]', () => {
    const def: SfxDef = {
      gain: 4,
      voices: [{ shape: 'square', freq: 200, sustain: 0.5, delay: 0.25 }],
    };
    const out = synthesize(def, SR);
    expect(out.length).toBe(Math.ceil(sfxDuration(def) * SR));
    expect(out.length).toBe(6000);
    expect(Math.max(...out)).toBe(1);
    expect(Math.min(...out)).toBe(-1);
    // Silent during the delay.
    expect(out.subarray(0, 2000).every((x) => x === 0)).toBe(true);
  });

  it('produces the requested pitch for every shape', () => {
    for (const shape of ['sine', 'triangle', 'saw', 'square'] as const) {
      expect(cycles(synthesize(tone({ shape }), SR))).toBeGreaterThanOrEqual(439);
      expect(cycles(synthesize(tone({ shape }), SR))).toBeLessThanOrEqual(441);
    }
  });

  it('applies slide and pitch jump', () => {
    const up = synthesize(tone({ freq: 200, jump: 12, jumpTime: 0.5 }), SR);
    expect(cycles(up, 0, 4000)).toBeCloseTo(100, -1);
    expect(cycles(up, 4000, 8000)).toBeCloseTo(200, -1);
    const slide = synthesize(tone({ freq: 400, slide: -400 }), SR);
    expect(cycles(slide, 0, 800)).toBeGreaterThan(cycles(slide, 7200, 8000));
  });

  it('is deterministic per seed for noise, and the seed matters', () => {
    const def: SfxDef = { voices: [{ shape: 'noise', freq: 0, sustain: 0.1, lowpass: 500 }] };
    expect(synthesize(def, SR, 7)).toEqual(synthesize(def, SR, 7));
    expect(synthesize(def, SR, 7)).not.toEqual(synthesize(def, SR, 8));
  });

  it('low-pass reduces high-frequency energy', () => {
    const energy = (x: Float32Array): number =>
      x.reduce((s, v, i) => s + Math.abs(v - (x[i - 1] ?? 0)), 0);
    const raw = synthesize({ voices: [{ shape: 'noise', freq: 0, sustain: 0.2 }] }, SR, 3);
    const lp = synthesize(
      { voices: [{ shape: 'noise', freq: 0, sustain: 0.2, lowpass: 200 }] },
      SR,
      3,
    );
    expect(energy(lp)).toBeLessThan(energy(raw) / 4);
  });

  it('renders at least one sample for an empty sound', () => {
    expect(synthesize({ voices: [] }, SR).length).toBe(1);
  });
});

describe('makeVariants', () => {
  const def: SfxDef = {
    pitchJitter: 1,
    voices: [
      { shape: 'sine', freq: 400, attack: 0.1, sustain: 0.2 },
      { shape: 'sine', freq: 600 },
    ],
  };

  it('keeps variant 0 as the definition and caps the count at 2..3', () => {
    const vs = makeVariants(def, 5);
    expect(vs).toHaveLength(3);
    expect(vs[0]).toBe(def);
    expect(makeVariants(def, 5, 2)).toHaveLength(2);
    expect(makeVariants(def, 5, 9)).toHaveLength(3);
  });

  it('is seeded and stays within the jitter bounds, keeping intervals', () => {
    expect(makeVariants(def, 5)).toEqual(makeVariants(def, 5));
    expect(makeVariants(def, 5)).not.toEqual(makeVariants(def, 6));
    for (const v of makeVariants(def, 11).slice(1)) {
      const semis = 12 * Math.log2(v.voices[0]!.freq / 400);
      expect(Math.abs(semis)).toBeGreaterThan(0.39);
      expect(Math.abs(semis)).toBeLessThanOrEqual(1);
      expect(v.voices[1]!.freq / v.voices[0]!.freq).toBeCloseTo(1.5);
      expect(v.voices[0]!.attack! / 0.1).toBeGreaterThanOrEqual(0.9);
      expect(v.voices[0]!.attack! / 0.1).toBeLessThanOrEqual(1.1);
    }
  });

  it('puts variants 1 and 2 on opposite sides of the base pitch', () => {
    const [, a, b] = makeVariants(def, 3);
    expect(Math.sign(a!.voices[0]!.freq - 400)).toBe(-Math.sign(b!.voices[0]!.freq - 400));
  });
});
