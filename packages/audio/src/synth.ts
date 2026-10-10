/**
 * zzfx-class synthesizer (GDD §7): a sound is a list of parameter objects ("voices") rendered
 * offline into a mono Float32Array. Pure and seeded: the same params and seed give the same samples.
 */
import { rng, type Rng } from './rng.js';

export type Shape = 'sine' | 'triangle' | 'saw' | 'square' | 'noise';

/** One oscillator with an ADSR envelope. Times are seconds, frequencies Hz. */
export interface Voice {
  shape: Shape;
  /** Start frequency in Hz (ignored for pitch by `noise`, but still drives `lowpass` grit). */
  freq: number;
  /** Peak level, 0..1. Default 1. */
  volume?: number;
  /** Silence before this voice starts. */
  delay?: number;
  attack?: number;
  /** Time from peak down to `sustainLevel`. */
  decay?: number;
  /** Time held at `sustainLevel`. */
  sustain?: number;
  release?: number;
  /** Level after decay, 0..1. Default 1. */
  sustainLevel?: number;
  /** Linear pitch slide in Hz per second (negative falls). */
  slide?: number;
  /** Pitch jump in semitones applied once `jumpTime` has passed. */
  jump?: number;
  jumpTime?: number;
  /** Random per-sample pitch wobble, 0..1 (zzfx "noise"). */
  noise?: number;
  /** Square-wave duty cycle, 0..1. Default 0.5. */
  duty?: number;
  /** One-pole low-pass cutoff in Hz; omitted = off. */
  lowpass?: number;
}

/** An SFX definition: the voices of one sound plus how its seeded variants may differ. */
export interface SfxDef {
  voices: Voice[];
  /** Overall gain applied after mixing the voices. Default 1. */
  gain?: number;
  /** Max pitch deviation of a variant, semitones. Default 0.5. */
  pitchJitter?: number;
  /** Max relative deviation of a variant's envelope times. Default 0.1. */
  timeJitter?: number;
}

const TAU = Math.PI * 2;

/** Total length of a voice in seconds. */
export function voiceDuration(v: Voice): number {
  return (v.delay ?? 0) + (v.attack ?? 0) + (v.decay ?? 0) + (v.sustain ?? 0) + (v.release ?? 0);
}

/** Envelope level at time t (seconds since the voice's onset). */
export function envelope(v: Voice, t: number): number {
  const a = v.attack ?? 0;
  const d = v.decay ?? 0;
  const s = v.sustain ?? 0;
  const r = v.release ?? 0;
  const sl = v.sustainLevel ?? 1;
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - sl) * ((t - a) / d);
  if (t < a + d + s) return sl;
  if (t < a + d + s + r) return sl * (1 - (t - a - d - s) / r);
  return 0;
}

function osc(shape: Shape, p: number, duty: number, r: Rng): number {
  switch (shape) {
    case 'sine':
      return Math.sin(TAU * p);
    case 'triangle':
      return 1 - 4 * Math.abs(p - 0.5);
    case 'saw':
      return 2 * p - 1;
    case 'square':
      return p < duty ? 1 : -1;
    case 'noise':
      return r() * 2 - 1;
  }
}

/** Renders a voice and adds it into `out`. */
function renderVoice(v: Voice, out: Float32Array, sampleRate: number, r: Rng): void {
  const start = Math.round((v.delay ?? 0) * sampleRate);
  const len = Math.min(
    out.length - start,
    Math.ceil((voiceDuration(v) - (v.delay ?? 0)) * sampleRate),
  );
  const vol = v.volume ?? 1;
  const slide = v.slide ?? 0;
  const jumpMul = v.jump ? Math.pow(2, v.jump / 12) : 1;
  const jumpAt = v.jumpTime ?? Infinity;
  const noise = v.noise ?? 0;
  const duty = v.duty ?? 0.5;
  const lp = v.lowpass ? 1 - Math.exp((-TAU * v.lowpass) / sampleRate) : 1;
  let phase = 0;
  let y = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    let f = Math.max(0, v.freq + slide * t) * (t >= jumpAt ? jumpMul : 1);
    if (noise) f *= 1 + noise * (r() * 2 - 1);
    phase += f / sampleRate;
    phase -= Math.floor(phase);
    y += lp * (osc(v.shape, phase, duty, r) - y);
    out[start + i] = (out[start + i] ?? 0) + y * envelope(v, t) * vol;
  }
}

/** Length in seconds of a whole SFX. */
export function sfxDuration(def: SfxDef): number {
  return Math.max(0, ...def.voices.map(voiceDuration));
}

/**
 * Renders an SFX to mono samples in [-1, 1]. `seed` drives noise voices and pitch wobble, so the
 * output is a pure function of (def, sampleRate, seed).
 */
export function synthesize(def: SfxDef, sampleRate: number, seed = 1): Float32Array {
  const out = new Float32Array(Math.max(1, Math.ceil(sfxDuration(def) * sampleRate)));
  const r = rng(seed);
  for (const v of def.voices) renderVoice(v, out, sampleRate, r);
  const g = def.gain ?? 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, (out[i] ?? 0) * g));
  return out;
}

const scaleTimes = (v: Voice, k: number): Voice => {
  const o: Voice = { ...v };
  for (const key of ['attack', 'decay', 'sustain', 'release'] as const) {
    const x = v[key];
    if (x !== undefined) o[key] = x * k;
  }
  return o;
};

/**
 * The seeded variants of a sound (GDD §7: "2–3 seeded variants to avoid machine-gun
 * repetition"). Variant 0 is the definition itself; the others shift every voice's pitch by one
 * shared amount within ±pitchJitter semitones and scale envelope times within ±timeJitter, so a
 * variant keeps the sound's shape and chord intervals.
 */
export function makeVariants(def: SfxDef, seed: number, count = 3): SfxDef[] {
  const n = Math.max(1, Math.min(3, Math.floor(count)));
  const r = rng(seed);
  const pj = def.pitchJitter ?? 0.5;
  const tj = def.timeJitter ?? 0.1;
  const out: SfxDef[] = [def];
  for (let i = 1; i < n; i++) {
    // Alternate sides so two variants never land on the same pitch.
    const side = i % 2 === 1 ? 1 : -1;
    const semis = side * pj * (0.4 + 0.6 * r());
    const k = 1 + tj * (r() * 2 - 1);
    const mul = Math.pow(2, semis / 12);
    out.push({
      ...def,
      voices: def.voices.map((v) => ({ ...scaleTimes(v, k), freq: v.freq * mul })),
    });
  }
  return out;
}
