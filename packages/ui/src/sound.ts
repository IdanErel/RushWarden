/**
 * The run screen's sound (P1-AUD-01 wiring, GDD §7 audio, §9 "sound starts after user gesture").
 * `createGameSound` wraps `AudioEngine` from @rushwarden/audio with the player's saved on/off
 * choice. Sound is off until the player turns it on (ADR-007), and no AudioContext exists before
 * a user gesture made while sound is on (the engine's rule). The choice is kept in localStorage;
 * every storage access is guarded, so blocked storage only means the choice is not remembered.
 */
import {
  AudioEngine,
  type AudioContextLike,
  type EventTargetLike,
  type PlayOptions,
  type SfxId,
} from '@rushwarden/audio';
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
  /**
   * Defaults to a new `AudioEngine` (muted) whose AudioContext `dispose` closes. A passed engine
   * is the caller's: `dispose` unbinds from it but leaves its context alone.
   */
  readonly engine?: SoundEngine;
  /** The default engine's AudioContext factory; defaults to the browser's (tests pass a fake). */
  readonly createContext?: () => ClosableContext;
  /** Where the on/off choice is kept; defaults to `localStorage` when it can be reached. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Gesture source for the unlock; defaults to `window`. */
  readonly gestures?: EventTargetLike;
  /** Background mute (`visibilitychange`); defaults to `document`. */
  readonly visibility?: EventTargetLike & { readonly hidden: boolean };
}

/** A closable AudioContext: the browser's own (`AudioContext` or `webkitAudioContext`). */
export type ClosableContext = AudioContextLike & { close?(): Promise<void> };

function browserContext(): ClosableContext {
  const g = globalThis as unknown as {
    AudioContext?: new () => ClosableContext;
    webkitAudioContext?: new () => ClosableContext;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio unavailable');
  return new Ctor();
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
  // The engine keeps its context private, so the default engine gets it from a factory that
  // remembers it, for `dispose` to close.
  let context: ClosableContext | null = null;
  const engine =
    opts.engine ??
    new AudioEngine({
      createContext: () => {
        context = (opts.createContext ?? browserContext)();
        return context;
      },
    });
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  if (loadSoundOn(storage)) engine.setMuted(false);
  const unbind: (() => void)[] = [];
  const gestures = opts.gestures ?? (globalThis as unknown as { window?: EventTargetLike }).window;
  if (gestures) unbind.push(engine.bindGestureUnlock(gestures));
  const doc =
    opts.visibility ??
    (globalThis as unknown as { document?: EventTargetLike & { hidden: boolean } }).document;
  if (doc) unbind.push(engine.bindVisibility(doc));
  let disposed = false;
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
    play: (id, options) => (disposed ? false : engine.play(id, options)),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const off of unbind) off();
      // Browsers cap live AudioContexts, so a remounted screen must not leave this one running.
      const ctx = context as ClosableContext | null;
      context = null;
      void ctx?.close?.().catch(() => {});
    },
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
