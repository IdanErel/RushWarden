/**
 * The run screen's sound (P1-AUD-01 wiring, GDD §7 audio, §9 "sound starts after user gesture").
 * `createGameSound` wraps `AudioEngine` from @rushwarden/audio with the player's saved on/off
 * choice. Sound is off until the player turns it on (ADR-007), and no AudioContext exists before
 * a user gesture made while sound is on (the engine's rule). The choice is kept in localStorage;
 * every storage access is guarded, so blocked storage only means the choice is not remembered.
 */
import { AudioEngine, type EventTargetLike, type PlayOptions, type SfxId } from '@rushwarden/audio';
import type { SoundControl } from './config.js';

/** localStorage key for the sound on/off choice: `'on'` or `'off'`. */
export const SOUND_KEY = 'rushwarden.sound';

/** Minimum wall-clock gap between two vehicle-exit sounds, so a rush of exits stays a patter. */
export const EXIT_SOUND_GAP_MS = 120;

/** The saved choice; false (off) when nothing is saved or storage is unavailable. */
export function loadSoundOn(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveSoundOn(storage: Pick<Storage, 'setItem'> | null, on: boolean): void {
  try {
    storage?.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked (private mode, sandboxed iframe): the choice lasts this page only.
  }
}

/** The engine surface `createGameSound` uses; `AudioEngine` satisfies it. */
export interface SoundEngine {
  readonly muted: boolean;
  readonly started: boolean;
  setMuted(muted: boolean): void;
  setSoundOnFromGesture(on: boolean): boolean;
  play(id: SfxId, options?: PlayOptions): boolean;
  bindGestureUnlock(target: EventTargetLike): () => void;
  bindVisibility(doc: EventTargetLike & { readonly hidden: boolean }): () => void;
}

export interface GameSoundOptions {
  /** Defaults to a new `AudioEngine` (muted). */
  readonly engine?: SoundEngine;
  /** Where the on/off choice is kept; defaults to `localStorage` when it can be reached. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Gesture source for the unlock; defaults to `window`. */
  readonly gestures?: EventTargetLike;
  /** Background mute (`visibilitychange`); defaults to `document`. */
  readonly visibility?: EventTargetLike & { readonly hidden: boolean };
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Sound for one run screen: restores the saved choice (sound on still waits for the next
 * gesture), unlocks on the first gesture while sound is on, mutes in the background, and saves
 * the choice whenever the toggle changes it.
 */
export function createGameSound(opts: GameSoundOptions = {}): SoundControl {
  const engine = opts.engine ?? new AudioEngine();
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  if (loadSoundOn(storage)) engine.setMuted(false);
  const gestures = opts.gestures ?? (globalThis as unknown as { window?: EventTargetLike }).window;
  if (gestures) engine.bindGestureUnlock(gestures);
  const doc =
    opts.visibility ??
    (globalThis as unknown as { document?: EventTargetLike & { hidden: boolean } }).document;
  if (doc) engine.bindVisibility(doc);
  return {
    get muted() {
      return engine.muted;
    },
    get started() {
      return engine.started;
    },
    setSoundOnFromGesture(on: boolean): boolean {
      saveSoundOn(storage, on);
      return engine.setSoundOnFromGesture(on);
    },
    play: (id, options) => engine.play(id, options),
  };
}

/** Lets a sound through at most once per `gapMs` of wall-clock time. */
export class Throttle {
  private last = -Infinity;
  constructor(private readonly gapMs: number) {}
  /** True (and records `now`) when at least `gapMs` passed since the last pass. */
  pass(now: number): boolean {
    if (now - this.last < this.gapMs) return false;
    this.last = now;
    return true;
  }
}
