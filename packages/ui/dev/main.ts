/**
 * Run screen dev page: the real run controller (P1-BAL-01) with dev stand-in cards, fake traffic
 * in the worker (or `source=sim`), test hooks on. Query: `seed` (H1-style run seed), `privacy`
 * (policy URL), `reduced=1`, `source=sim`. Not shipped; Platform mounts the game in platform-web.
 */
import { toyRunConfig, type RunAnalytics } from '@rushwarden/app';
import { spawnFakeWorker, spawnSimWorker, tileLaneLayout } from '@rushwarden/render';
import { ControllerRun, mountGame, type SoundControl } from '../src/index.js';
import { DEV_CARDS, devCatalog, devEnv } from './cards.js';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? '1') >>> 0;
const sim = q.get('source') === 'sim';

/** Records toggle calls so e2e can check the gesture rule (AUD note on PR #15). */
const soundCalls: boolean[] = [];
const sound: SoundControl & { muted: boolean } = {
  muted: true,
  setSoundOnFromGesture(on: boolean) {
    soundCalls.push(on);
    this.muted = !on;
    return true;
  },
};

/** Stands in for the ingest client's `track()`; e2e reads the calls. */
const trackCalls: { event: string; props: unknown }[] = [];
const analytics: RunAnalytics = { track: (event, props) => trackCalls.push({ event, props }) };

mountGame(document.getElementById('app') as HTMLElement, {
  run: new ControllerRun({
    config: toyRunConfig({ seed, cards: DEV_CARDS }),
    env: devEnv,
    catalog: devCatalog,
    analytics,
  }),
  spawnWorker: sim ? spawnSimWorker : spawnFakeWorker,
  ...(sim ? {} : { layout: tileLaneLayout }),
  config: { privacyUrl: q.get('privacy') ?? '', shareUrl: '' },
  installId: () => 'test-install-0000',
  sound,
  testHooks: true,
  reducedMotion: q.get('reduced') === '1',
});
Object.assign(window, { soundCalls, trackCalls });
