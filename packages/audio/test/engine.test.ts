import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, GESTURE_EVENTS, type AudioContextLike } from '../src/engine.js';
import { FakeAudioContext, FakeTarget } from './fake-audio.js';

// Compile-time check: the browser's AudioContext satisfies the engine's interface.
const _real: AudioContextLike = null as unknown as AudioContext;
void _real;

function setup(opts: ConstructorParameters<typeof AudioEngine>[0] = {}) {
  const ctx = new FakeAudioContext();
  const factory = vi.fn(() => ctx);
  const engine = new AudioEngine({ muted: false, createContext: factory, ...opts });
  return { ctx, factory, engine };
}

describe('AudioEngine: start only after a user gesture', () => {
  it('creates no context and plays nothing before unlock', () => {
    const { engine, factory } = setup();
    expect(engine.started).toBe(false);
    expect(engine.play('go')).toBe(false);
    engine.prewarm();
    engine.setBackground(true);
    expect(factory).not.toHaveBeenCalled();
  });

  it('unlocks on the first gesture event, resumes, then removes its listeners', () => {
    const { engine, factory, ctx } = setup();
    const target = new FakeTarget();
    engine.bindGestureUnlock(target);
    expect(target.count()).toBe(GESTURE_EVENTS.length);
    target.dispatch('mousemove');
    expect(factory).not.toHaveBeenCalled();
    target.dispatch('pointerdown');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
    expect(target.count()).toBe(0);
    expect(engine.unlock()).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('builds source -> sfx bus -> master -> destination', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    expect(engine.play('cardPlace')).toBe(true);
    const [master, sfx] = ctx.gains;
    const src = ctx.sources[0]!;
    expect(src.outputs).toEqual([sfx]);
    expect(sfx!.outputs).toEqual([master]);
    expect(master!.outputs).toEqual([ctx.destination]);
    expect(src.startedAt).toBe(0);
    expect(src.buffer).not.toBeNull();
  });

  it('never throws when Web Audio is missing or broken', () => {
    const engine = new AudioEngine({
      muted: false,
      createContext: () => {
        throw new Error('no audio');
      },
    });
    expect(engine.unlock()).toBe(false);
    expect(engine.play('go')).toBe(false);
    const target = new FakeTarget();
    engine.bindGestureUnlock(target);
    target.dispatch('click');
    expect(target.count()).toBe(GESTURE_EVENTS.length); // keeps trying on later gestures
  });

  it('the default factory fails safely in Node (no AudioContext global)', () => {
    expect(new AudioEngine({ muted: false }).unlock()).toBe(false);
  });
});

describe('AudioEngine: mixer', () => {
  it('is muted by default and never creates or resumes a context while muted (ADR-007)', () => {
    const ctx = new FakeAudioContext();
    const factory = vi.fn(() => ctx);
    const engine = new AudioEngine({ createContext: factory });
    const target = new FakeTarget();
    engine.bindGestureUnlock(target);
    expect(engine.muted).toBe(true);
    expect(engine.unlock()).toBe(false);
    target.dispatch('pointerdown');
    target.dispatch('keydown');
    expect(factory).not.toHaveBeenCalled();
    expect(ctx.resumeCalls).toBe(0);
    expect(target.count()).toBe(GESTURE_EVENTS.length); // still waiting for a gesture with sound on
    expect(engine.play('go')).toBe(false);
  });

  it('setMuted(false) outside a gesture does not start audio; the next gesture does', () => {
    const ctx = new FakeAudioContext();
    const factory = vi.fn(() => ctx);
    const engine = new AudioEngine({ createContext: factory });
    const target = new FakeTarget();
    engine.bindGestureUnlock(target);
    target.dispatch('click'); // muted: ignored
    engine.setMuted(false); // e.g. restoring saved settings at boot
    expect(factory).not.toHaveBeenCalled();
    target.dispatch('touchend');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.gains[0]!.gain.value).toBe(0.8);
    expect(target.count()).toBe(0);
    expect(engine.play('go')).toBe(true);
  });

  it('setSoundOnFromGesture unlocks in the toggle gesture itself, and turning off mutes', () => {
    const ctx = new FakeAudioContext();
    const factory = vi.fn(() => ctx);
    const engine = new AudioEngine({ createContext: factory });
    expect(engine.setSoundOnFromGesture(false)).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(engine.setSoundOnFromGesture(true)).toBe(true);
    expect(engine.muted).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
    expect(engine.play('go')).toBe(true);
    expect(engine.setSoundOnFromGesture(false)).toBe(false);
    expect(engine.muted).toBe(true);
    expect(ctx.gains[0]!.gain.value).toBe(0);
    ctx.currentTime = 1;
    expect(engine.play('go')).toBe(false);
  });

  it('applies and clamps master and SFX volume', () => {
    const { engine, ctx } = setup({ masterVolume: 0.5, sfxVolume: 0.25 });
    engine.unlock();
    const [master, sfx] = ctx.gains;
    expect(master!.gain.value).toBe(0.5);
    expect(sfx!.gain.value).toBe(0.25);
    engine.setMasterVolume(2);
    engine.setSfxVolume(-1);
    expect(engine.masterVolume).toBe(1);
    expect(engine.sfxVolume).toBe(0);
    expect(master!.gain.value).toBe(1);
    expect(sfx!.gain.value).toBe(0);
    expect(engine.play('go')).toBe(false); // zero SFX volume: skip the work
    engine.setSfxVolume(Number.NaN);
    expect(engine.sfxVolume).toBe(0);
    engine.setSfxVolume(1);
    engine.setMuted(true);
    expect(master!.gain.value).toBe(0);
    expect(engine.play('go')).toBe(false);
  });

  it('pitch and per-play volume', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    engine.play('vehicleExit', { pitch: 12, volume: 0.5 });
    const src = ctx.sources[0]!;
    expect(src.playbackRate.value).toBeCloseTo(2);
    const g = src.outputs[0] as unknown as { gain: { value: number } };
    expect(g.gain.value).toBe(0.5);
  });

  it('suspends in the background and resumes in the foreground', () => {
    const { engine, ctx } = setup();
    const doc = new FakeTarget();
    engine.unlock();
    const unbind = engine.bindVisibility(doc);
    doc.hidden = true;
    doc.dispatch('visibilitychange');
    expect(ctx.suspendCalls).toBe(1);
    expect(engine.play('go')).toBe(false);
    doc.hidden = false;
    doc.dispatch('visibilitychange');
    expect(ctx.state).toBe('running');
    expect(engine.play('go')).toBe(true);
    unbind();
    expect(doc.count()).toBe(0);
  });
});

describe('AudioEngine: variants and voice limits', () => {
  it('renders 3 variant buffers per sound, lazily, once', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    expect(ctx.buffers).toHaveLength(0);
    engine.play('go');
    expect(ctx.buffers).toHaveLength(3);
    ctx.currentTime = 1;
    engine.play('go');
    expect(ctx.buffers).toHaveLength(3);
    engine.prewarm();
    expect(ctx.buffers).toHaveLength(18);
    expect(ctx.buffers.every((b) => b.data.some((x) => x !== 0))).toBe(true);
  });

  it('honours variants: 2', () => {
    const { engine, ctx } = setup({ variants: 2 });
    engine.unlock();
    engine.prewarm();
    expect(ctx.buffers).toHaveLength(12);
  });

  it('never repeats the same variant twice in a row, and is seeded', () => {
    const run = (seed: number): number[] => {
      const { engine, ctx } = setup({ seed });
      engine.unlock();
      const picks: number[] = [];
      for (let i = 0; i < 30; i++) {
        ctx.currentTime = i;
        engine.play('vehicleExit');
        const src = ctx.sources.at(-1)!;
        src.end();
        picks.push(ctx.buffers.indexOf(src.buffer as never));
      }
      return picks;
    };
    const a = run(9);
    for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1]);
    expect(new Set(a).size).toBe(3);
    expect(run(9)).toEqual(a);
  });

  it('drops a repeat of the same sound within minInterval but allows others', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    expect(engine.play('vehicleExit')).toBe(true);
    ctx.currentTime = 0.01;
    expect(engine.play('vehicleExit')).toBe(false);
    expect(engine.play('cardPlace')).toBe(true);
    ctx.currentTime = 0.05;
    expect(engine.play('vehicleExit')).toBe(true);
  });

  it('does not leak a voice when start() throws', () => {
    const { engine, ctx } = setup({ maxVoices: 2, minInterval: 0 });
    engine.unlock();
    ctx.failStart = true;
    for (let i = 0; i < 5; i++) expect(engine.play('go')).toBe(false);
    ctx.failStart = false;
    expect(engine.play('go')).toBe(true);
    expect(engine.play('go')).toBe(true);
    expect(engine.play('go')).toBe(false); // the cap counts only the two real voices
  });

  it('caps simultaneous voices and frees them when sounds end', () => {
    const { engine, ctx } = setup({ maxVoices: 2, minInterval: 0 });
    engine.unlock();
    expect(engine.play('go')).toBe(true);
    expect(engine.play('go')).toBe(true);
    expect(engine.play('go')).toBe(false);
    ctx.sources[0]!.end();
    expect(engine.play('go')).toBe(true);
  });
});
