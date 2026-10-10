/**
 * @rushwarden/audio — in-repo zzfx-class synth, SFX definitions and mixer (GDD §7). No audio files.
 * Owner: Audio Engineer.
 */
export { rng, hashString, type Rng } from './rng';
export {
  synthesize,
  makeVariants,
  envelope,
  voiceDuration,
  sfxDuration,
  type Shape,
  type Voice,
  type SfxDef,
} from './synth';
export { SFX, SFX_IDS, TAG_PITCH, exitPitch, type SfxId, type Tag } from './sfx';
export {
  AudioEngine,
  GESTURE_EVENTS,
  type AudioEngineOptions,
  type PlayOptions,
  type AudioContextLike,
  type AudioBufferLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BufferSourceLike,
  type GainNodeLike,
  type EventTargetLike,
} from './engine';
