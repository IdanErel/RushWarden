/**
 * Phase 1 SFX set (P1-AUD-01): card place, Go, vehicle exit, gridlock, quota pass, quota fail.
 * Every sound is a parameter object for the in-repo synth; there are no audio files.
 */
import type { SfxDef } from './synth';

export const SFX = {
  /** Soft wooden tick when a card lands; pitched per archetype tag at play time. */
  cardPlace: {
    gain: 0.5,
    voices: [
      {
        shape: 'triangle',
        freq: 660,
        attack: 0.003,
        decay: 0.07,
        sustainLevel: 0.2,
        release: 0.05,
        slide: -900,
      },
      {
        shape: 'noise',
        freq: 0,
        volume: 0.35,
        attack: 0.001,
        decay: 0.02,
        sustainLevel: 0,
        lowpass: 3500,
      },
    ],
  },
  /** Go button: a two-step rising square, filtered so it stays quiet. */
  go: {
    gain: 0.3,
    voices: [
      {
        shape: 'square',
        freq: 440,
        duty: 0.25,
        attack: 0.01,
        sustain: 0.16,
        release: 0.12,
        jump: 7,
        jumpTime: 0.08,
        lowpass: 2400,
      },
      {
        shape: 'sine',
        freq: 220,
        volume: 0.6,
        attack: 0.01,
        sustain: 0.16,
        release: 0.15,
        jump: 7,
        jumpTime: 0.08,
      },
    ],
  },
  /** Vehicle exit: a short pluck; pitched by score value at play time. */
  vehicleExit: {
    gain: 0.35,
    pitchJitter: 0.3,
    voices: [
      { shape: 'sine', freq: 880, attack: 0.002, decay: 0.09, sustainLevel: 0, slide: -400 },
      { shape: 'triangle', freq: 1760, volume: 0.25, attack: 0.002, decay: 0.04, sustainLevel: 0 },
    ],
  },
  /** Gridlock: descending diminished chord plus a low thud (GDD §7). */
  gridlock: {
    gain: 0.5,
    pitchJitter: 0.4,
    voices: [
      ...[330, 392, 466].map((freq) => ({
        shape: 'saw' as const,
        freq,
        volume: 0.4,
        attack: 0.01,
        sustain: 0.3,
        release: 0.45,
        slide: -freq * 0.6,
        lowpass: 1400,
      })),
      { shape: 'noise', freq: 0, attack: 0.002, decay: 0.25, sustainLevel: 0, lowpass: 160 },
      { shape: 'sine', freq: 75, attack: 0.002, decay: 0.35, sustainLevel: 0, slide: -80 },
    ],
  },
  /** Quota pass: rising major arpeggio. */
  quotaPass: {
    gain: 0.4,
    voices: [523.25, 659.25, 783.99, 1046.5].map((freq, i) => ({
      shape: 'triangle' as const,
      freq,
      delay: i * 0.07,
      attack: 0.005,
      decay: 0.12,
      sustainLevel: 0.3,
      release: 0.18,
    })),
  },
  /** Quota fail: two falling muted notes. */
  quotaFail: {
    gain: 0.3,
    voices: [392, 311.13].map((freq, i) => ({
      shape: 'square' as const,
      freq,
      duty: 0.4,
      delay: i * 0.16,
      attack: 0.01,
      sustain: 0.1,
      release: 0.2,
      slide: -freq * 0.15,
      lowpass: 900,
    })),
  },
} satisfies Record<string, SfxDef>;

export type SfxId = keyof typeof SFX;
export const SFX_IDS = Object.keys(SFX) as SfxId[];

/** Archetype tags as in GDD §4. */
export type Tag = 'FLOW' | 'MASS' | 'TOLL' | 'CHAOS' | 'TEMPO';

/** Card place pitch per tag, in semitones (a minor pentatonic so any two tags sound fine). */
export const TAG_PITCH: Record<Tag, number> = { FLOW: 0, MASS: 3, TOLL: 5, CHAOS: 7, TEMPO: 10 };

const PENTA = [0, 3, 5, 7, 10, 12];

/** Vehicle exit pitch in semitones for a vehicle's score value (§3: 1, 2, 3 or 5). */
export function exitPitch(score: number): number {
  const i = Math.max(0, Math.min(PENTA.length - 1, Math.round(score) - 1));
  return PENTA[i] ?? 0;
}
