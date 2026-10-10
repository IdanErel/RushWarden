# @rushwarden/audio

In-repo zzfx-class synthesizer, the SFX set and the mixer (GDD §7). No audio files and no
third-party audio code: every sound is a parameter object rendered to a buffer at runtime.

Owner: Audio Engineer. Phase 1 scope (P1-AUD-01): synth core, 5 SFX (card place, Go, vehicle
exit, gridlock, quota pass/fail), 2–3 seeded variants each, master/SFX volume and mute, start only
after a user gesture. Audio is off by default in the toy (ADR-007), so the engine starts muted.

## Public API

| Export                                                      | What it does                                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `AudioEngine`                                               | Mixer and playback. No `AudioContext` exists until `unlock()`; `play()` is a no-op until then.                                    |
| `engine.bindGestureUnlock(target)`                          | Unlocks on the first `pointerdown`/`touchend`/`keydown`/`click` on `target`, then unbinds.                                        |
| `engine.unlock()`                                           | Same, called by hand from inside a gesture handler. Idempotent; returns `false` if Web Audio is unavailable.                      |
| `engine.play(id, { pitch?, volume? })`                      | Plays a seeded variant (never the same one twice in a row). `pitch` is semitones. Returns `false` when it did nothing.            |
| `engine.setMuted` / `setMasterVolume` / `setSfxVolume`      | Mixer; volumes are clamped to 0..1.                                                                                               |
| `engine.bindVisibility(document)` / `setBackground(hidden)` | Mute on background (suspends the context).                                                                                        |
| `engine.prewarm()`                                          | Renders every variant now (about 100 ms total at 48 kHz); call on idle after unlock so a first play never renders on a hot frame. |
| `SFX`, `SFX_IDS`, `SfxId`                                   | The sound definitions: `cardPlace`, `go`, `vehicleExit`, `gridlock`, `quotaPass`, `quotaFail`.                                    |
| `TAG_PITCH`, `exitPitch(score)`                             | Card place pitch per archetype tag; vehicle exit pitch by score value.                                                            |
| `synthesize(def, sampleRate, seed)`                         | Pure: renders an `SfxDef` to a mono `Float32Array` in [-1, 1].                                                                    |
| `makeVariants(def, seed, count)`                            | The 2–3 seeded variants of a sound (shared pitch shift and envelope stretch).                                                     |
| `Voice`, `SfxDef`, `AudioContextLike`                       | Types. Any real `AudioContext` satisfies `AudioContextLike`; tests use a fake.                                                    |

Engine guards: at most 12 voices at once, and the same sound is dropped if replayed within 30 ms
(so a burst of vehicle exits does not machine-gun). Nothing in the engine throws into the game.

## Example

```ts
import { AudioEngine, TAG_PITCH, exitPitch } from '@rushwarden/audio';

const audio = new AudioEngine(); // muted by default
audio.bindGestureUnlock(window);
audio.bindVisibility(document);

settings.onSoundToggle((on) => audio.setMuted(!on));
onCardPlaced((card) => audio.play('cardPlace', { pitch: TAG_PITCH[card.tags[0]] }));
onGo(() => audio.play('go'));
onVehicleExit((v) => audio.play('vehicleExit', { pitch: exitPitch(v.score) }));
onGridlock(() => audio.play('gridlock'));
onRoundEnd((r) => audio.play(r.pass ? 'quotaPass' : 'quotaFail'));
```

## Adding a sound

Add an entry to `SFX` in `src/sfx.ts` (voices: `shape`, `freq`, ADSR times, `slide`, `jump`,
`noise`, `duty`, `lowpass`). `test/sfx.test.ts` checks every entry renders audibly, never clips,
and has distinct variants.
