/**
 * Mixer and playback (GDD §7 "Mixer", §9 "sound starts after user gesture").
 *
 * Graph: one buffer source per sound -> SFX bus gain -> master gain -> destination.
 * No AudioContext exists until `unlock()` runs, and `unlock()` is meant to be called from a user
 * gesture (or via `bindGestureUnlock`). Until then, and while muted, `play()` is a cheap no-op.
 * Nothing here throws into the game: audio failures only ever mean silence.
 */
import { hashString, rng, type Rng } from './rng';
import { makeVariants, synthesize } from './synth';
import { SFX, type SfxId } from './sfx';

/** The subset of the Web Audio API the engine uses; a real `AudioContext` satisfies it. */
export interface AudioParamLike {
  value: number;
}
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
}
export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}
export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}
export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  readonly playbackRate: AudioParamLike;
  onended: ((ev: never) => unknown) | null;
  start(when?: number): void;
}
export interface AudioContextLike {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

/** Anything with add/removeEventListener: `window`, `document`, a canvas. */
export interface EventTargetLike {
  addEventListener(type: string, fn: () => void, opts?: { passive?: boolean }): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface AudioEngineOptions {
  /** Builds the context on unlock. Default: the browser's AudioContext. */
  createContext?: () => AudioContextLike;
  /** Seed for variant generation and choice. Default 1. */
  seed?: number;
  /** Variants per sound, 2 or 3. Default 3. */
  variants?: number;
  /** Start muted. Default true: audio is off by default in the Phase 1 toy (ADR-007). */
  muted?: boolean;
  /** 0..1. Default 0.8. */
  masterVolume?: number;
  /** 0..1. Default 1. */
  sfxVolume?: number;
  /** Max sounds playing at once; extra plays are dropped. Default 12. */
  maxVoices?: number;
  /** Min seconds between two plays of the same sound; closer plays are dropped. Default 0.03. */
  minInterval?: number;
}

export interface PlayOptions {
  /** Pitch shift in semitones (see TAG_PITCH and exitPitch). */
  pitch?: number;
  /** Per-play volume, 0..1. Default 1. */
  volume?: number;
}

/** Events that count as a user gesture for autoplay policies (incl. iOS `touchend`). */
export const GESTURE_EVENTS = ['pointerdown', 'touchend', 'keydown', 'click'] as const;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

function browserContext(): AudioContextLike {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio unavailable');
  return new Ctor();
}

export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private sfxBus: GainNodeLike | null = null;
  private readonly buffers = new Map<SfxId, AudioBufferLike[]>();
  private readonly lastVariant = new Map<SfxId, number>();
  private readonly lastPlayed = new Map<SfxId, number>();
  private readonly pick: Rng;
  private readonly opts: Required<Omit<AudioEngineOptions, 'muted' | 'masterVolume' | 'sfxVolume'>>;
  private active = 0;
  private _muted: boolean;
  private _master: number;
  private _sfx: number;
  private _background = false;

  constructor(options: AudioEngineOptions = {}) {
    this.opts = {
      createContext: options.createContext ?? browserContext,
      seed: options.seed ?? 1,
      variants: options.variants ?? 3,
      maxVoices: options.maxVoices ?? 12,
      minInterval: options.minInterval ?? 0.03,
    };
    this._muted = options.muted ?? true;
    this._master = clamp01(options.masterVolume ?? 0.8);
    this._sfx = clamp01(options.sfxVolume ?? 1);
    this.pick = rng(this.opts.seed ^ 0x9e3779b9);
  }

  /** True once a context exists (after the first successful `unlock`). */
  get started(): boolean {
    return this.ctx !== null;
  }
  get muted(): boolean {
    return this._muted;
  }
  get masterVolume(): number {
    return this._master;
  }
  get sfxVolume(): number {
    return this._sfx;
  }

  /**
   * Creates and resumes the AudioContext. Call it from inside a user gesture handler; browsers and
   * portals (Poki, §9) reject audio started any other way. Idempotent. Returns whether audio is
   * available.
   */
  unlock(): boolean {
    try {
      if (!this.ctx) {
        const ctx = this.opts.createContext();
        const master = ctx.createGain();
        const sfx = ctx.createGain();
        sfx.connect(master);
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        this.sfxBus = sfx;
        this.applyGains();
      }
      if (this.ctx.state === 'suspended' && !this._background)
        void this.ctx.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Unlocks on the first user gesture on `target` (e.g. `window`), then removes its listeners.
   * Returns a function that removes them early.
   */
  bindGestureUnlock(target: EventTargetLike): () => void {
    const off = (): void => {
      for (const t of GESTURE_EVENTS) target.removeEventListener(t, on);
    };
    const on = (): void => {
      if (this.unlock()) off();
    };
    for (const t of GESTURE_EVENTS) target.addEventListener(t, on, { passive: true });
    return off;
  }

  /** Mute on background (GDD §7): pass `document.hidden` on every `visibilitychange`. */
  setBackground(hidden: boolean): void {
    this._background = hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    const p = hidden ? ctx.suspend() : ctx.resume();
    void p.catch(() => {});
  }

  /** Wires `setBackground` to a document's `visibilitychange`. Returns an unbind function. */
  bindVisibility(doc: EventTargetLike & { readonly hidden: boolean }): () => void {
    const on = (): void => this.setBackground(doc.hidden);
    doc.addEventListener('visibilitychange', on);
    return () => doc.removeEventListener('visibilitychange', on);
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    this.applyGains();
  }
  setMasterVolume(v: number): void {
    this._master = clamp01(v);
    this.applyGains();
  }
  setSfxVolume(v: number): void {
    this._sfx = clamp01(v);
    this.applyGains();
  }

  /**
   * Plays a sound. Returns false (and does nothing) before unlock, while muted or in the
   * background, at zero volume, when the voice cap is reached, or within `minInterval` of the
   * same sound.
   */
  play(id: SfxId, options: PlayOptions = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || this._muted || this._background || this._master * this._sfx === 0) {
      return false;
    }
    if (this.active >= this.opts.maxVoices) return false;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(id);
    if (last !== undefined && now - last < this.opts.minInterval) return false;
    try {
      const buffers = this.variantBuffers(id);
      const src = ctx.createBufferSource();
      src.buffer = buffers[this.chooseVariant(id, buffers.length)] ?? null;
      src.playbackRate.value = Math.pow(2, (options.pitch ?? 0) / 12);
      let out: AudioNodeLike = src;
      const vol = options.volume ?? 1;
      if (vol !== 1) {
        const g = ctx.createGain();
        g.gain.value = clamp01(vol);
        src.connect(g);
        out = g;
      }
      out.connect(this.sfxBus);
      this.active++;
      src.onended = () => {
        this.active = Math.max(0, this.active - 1);
      };
      src.start(now);
      this.lastPlayed.set(id, now);
      return true;
    } catch {
      return false;
    }
  }

  /** Renders every variant of every sound now (e.g. on an idle callback after unlock). */
  prewarm(): void {
    if (!this.ctx) return;
    for (const id of Object.keys(SFX) as SfxId[]) this.variantBuffers(id);
  }

  private variantBuffers(id: SfxId): AudioBufferLike[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    let list = this.buffers.get(id);
    if (!list) {
      const seed = (hashString(id) ^ this.opts.seed) >>> 0;
      list = makeVariants(SFX[id], seed, this.opts.variants).map((def, i) => {
        const data = synthesize(def, ctx.sampleRate, seed + i);
        const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        buf.getChannelData(0).set(data);
        return buf;
      });
      this.buffers.set(id, list);
    }
    return list;
  }

  /** Seeded pick that never repeats the previous variant of the same sound. */
  private chooseVariant(id: SfxId, n: number): number {
    if (n <= 1) return 0;
    const prev = this.lastVariant.get(id);
    let i = Math.floor(this.pick() * (prev === undefined ? n : n - 1));
    if (prev !== undefined && i >= prev) i++;
    this.lastVariant.set(id, i);
    return i;
  }

  private applyGains(): void {
    if (this.master) this.master.gain.value = this._muted ? 0 : this._master;
    if (this.sfxBus) this.sfxBus.gain.value = this._sfx;
  }
}
