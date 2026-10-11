import { describe, expect, it } from 'vitest';
import type { EventTargetLike, PlayOptions, SfxId } from '@rushwarden/audio';
import {
  SOUND_KEY,
  Throttle,
  createGameSound,
  loadSoundOn,
  saveSoundOn,
  type ClosableContext,
  type SoundEngine,
} from '../src/sound.js';

class MemStorage {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

const throwing = {
  getItem(): string | null {
    throw new Error('SecurityError');
  },
  setItem(): void {
    throw new Error('QuotaExceededError');
  },
};

class FakeEngine implements SoundEngine {
  muted = true;
  started = false;
  readonly calls: string[] = [];
  readonly bound: string[] = [];
  setMuted(m: boolean): void {
    this.calls.push(`setMuted:${m}`);
    this.muted = m;
  }
  setSoundOnFromGesture(on: boolean): boolean {
    this.calls.push(`gesture:${on}`);
    this.muted = !on;
    this.started ||= on;
    return on;
  }
  play(id: SfxId, o?: PlayOptions): boolean {
    this.calls.push(`play:${id}:${o?.pitch ?? 0}`);
    return this.started && !this.muted;
  }
  bindGestureUnlock(_t: EventTargetLike): () => void {
    this.bound.push('gesture');
    return () => undefined;
  }
  bindVisibility(_d: EventTargetLike & { readonly hidden: boolean }): () => void {
    this.bound.push('visibility');
    return () => undefined;
  }
}

const target: EventTargetLike & { hidden: boolean } = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
};

describe('saved sound choice', () => {
  it('is off unless "on" was saved, and survives blocked storage', () => {
    const st = new MemStorage();
    expect(loadSoundOn(st)).toBe(false);
    saveSoundOn(st, true);
    expect(st.getItem(SOUND_KEY)).toBe('on');
    expect(loadSoundOn(st)).toBe(true);
    saveSoundOn(st, false);
    expect(loadSoundOn(st)).toBe(false);
    expect(loadSoundOn(null)).toBe(false);
    expect(loadSoundOn(throwing)).toBe(false);
    expect(() => saveSoundOn(throwing, true)).not.toThrow();
  });
});

describe('createGameSound (P1-AUD-01 wiring)', () => {
  const make = (storage: MemStorage | typeof throwing | null, engine = new FakeEngine()) => ({
    engine,
    sound: createGameSound({ engine, storage, gestures: target, visibility: target }),
  });

  it('starts muted (ADR-007) and binds the gesture unlock and background mute', () => {
    const { engine, sound } = make(new MemStorage());
    expect(sound.muted).toBe(true);
    expect(sound.started).toBe(false);
    expect(engine.calls).toEqual([]);
    expect(engine.bound).toEqual(['gesture', 'visibility']);
  });

  it('restores a saved "on" without starting audio (the next gesture does)', () => {
    const st = new MemStorage();
    st.setItem(SOUND_KEY, 'on');
    const { engine, sound } = make(st);
    expect(engine.calls).toEqual(['setMuted:false']);
    expect(sound.muted).toBe(false);
    expect(sound.started).toBe(false);
  });

  it('saves the toggle and starts audio from the toggle gesture', () => {
    const st = new MemStorage();
    const { engine, sound } = make(st);
    expect(sound.setSoundOnFromGesture(true)).toBe(true);
    expect(st.getItem(SOUND_KEY)).toBe('on');
    expect(sound.started).toBe(true);
    expect(sound.play?.('go')).toBe(true);
    sound.setSoundOnFromGesture(false);
    expect(st.getItem(SOUND_KEY)).toBe('off');
    expect(sound.play?.('cardPlace', { pitch: 3 })).toBe(false);
    expect(engine.calls).toEqual([
      'gesture:true',
      'play:go:0',
      'gesture:false',
      'play:cardPlace:3',
    ]);
  });

  it('works with storage blocked: the choice just is not remembered', () => {
    const { sound } = make(throwing);
    expect(() => sound.setSoundOnFromGesture(true)).not.toThrow();
    expect(sound.muted).toBe(false);
  });
});

/** An event target that counts its listeners. */
class Listeners implements EventTargetLike {
  hidden = false;
  readonly fns = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void): void {
    const set = this.fns.get(type) ?? new Set();
    set.add(fn);
    this.fns.set(type, set);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.fns.get(type)?.delete(fn);
  }
  get count(): number {
    let n = 0;
    for (const s of this.fns.values()) n += s.size;
    return n;
  }
  fire(type: string): void {
    for (const fn of [...(this.fns.get(type) ?? [])]) fn();
  }
}

/** Just enough of an AudioContext for the engine to start; records `close`. */
function fakeContext(): ClosableContext & { closed: number } {
  const node = { connect: () => undefined };
  return {
    closed: 0,
    sampleRate: 8000,
    currentTime: 0,
    state: 'running',
    destination: node,
    createGain: () => ({ ...node, gain: { value: 1 } }),
    createBuffer: () => ({ getChannelData: () => new Float32Array(1) }),
    createBufferSource: () => ({
      ...node,
      buffer: null,
      playbackRate: { value: 1 },
      onended: null,
      start: () => undefined,
    }),
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    close() {
      this.closed++;
      return Promise.resolve();
    },
  };
}

describe('dispose (#86 review: nothing was cleaned up on unmount)', () => {
  it('removes the gesture and visibility listeners and closes the AudioContext it made', () => {
    const win = new Listeners();
    const doc = new Listeners();
    const made: ReturnType<typeof fakeContext>[] = [];
    const sound = createGameSound({
      storage: new MemStorage(),
      gestures: win,
      visibility: doc,
      createContext: () => {
        const c = fakeContext();
        made.push(c);
        return c;
      },
    });
    expect(win.count).toBeGreaterThan(0);
    expect(doc.count).toBe(1);
    expect(sound.setSoundOnFromGesture(true)).toBe(true);
    expect(sound.started).toBe(true);
    expect(made).toHaveLength(1);

    sound.dispose?.();
    expect(win.count).toBe(0);
    expect(doc.count).toBe(0);
    expect(made[0]?.closed).toBe(1);
    expect(sound.play?.('go')).toBe(false);
    // Twice is harmless.
    sound.dispose?.();
    expect(made[0]?.closed).toBe(1);
  });

  it('with sound never turned on, there is no context to close, and listeners still go', () => {
    const win = new Listeners();
    const doc = new Listeners();
    let created = 0;
    const sound = createGameSound({
      storage: new MemStorage(),
      gestures: win,
      visibility: doc,
      createContext: () => {
        created++;
        return fakeContext();
      },
    });
    win.fire('pointerdown'); // muted: no context
    sound.dispose?.();
    expect(created).toBe(0);
    expect(win.count + doc.count).toBe(0);
  });

  it('a passed engine is unbound but its context is left to its owner', () => {
    const offs: string[] = [];
    const engine = new FakeEngine();
    engine.bindGestureUnlock = () => () => offs.push('gesture');
    engine.bindVisibility = () => () => offs.push('visibility');
    const sound = createGameSound({ engine, storage: null, gestures: target, visibility: target });
    sound.dispose?.();
    expect(offs).toEqual(['gesture', 'visibility']);
  });
});

describe('Throttle', () => {
  it('lets one through per gap', () => {
    const th = new Throttle(120);
    expect(th.pass(0)).toBe(true);
    expect(th.pass(50)).toBe(false);
    expect(th.pass(119)).toBe(false);
    expect(th.pass(120)).toBe(true);
    expect(th.pass(500)).toBe(true);
  });
});
