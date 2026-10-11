/**
 * Run screen dev page: the real run controller (P1-BAL-01) with dev stand-in cards, fake traffic
 * in the worker (or `source=sim`), test hooks on. Query: `seed` (H1-style run seed), `privacy`
 * (policy URL), `share` (share URL), `rounds`, `reduced=1`, `source=sim`, `portal` (`poki`, `crazygames`, ...), `analytics=1`
 * (a stand-in consent surface; `consent=yes|no` presets the answer, `deleteFail=1` fails the
 * delete). Not shipped; Platform mounts the game in platform-web.
 */
import { toyRunConfig, type RunAnalytics } from '@rushwarden/app';
import { spawnSimWorker, tileLaneLayout } from '@rushwarden/render';
import { spawnFakeWorker } from '@rushwarden/render/fake-worker';
import {
  ControllerRun,
  mountGame,
  type PrivacyControls,
  type SoundControl,
  type UiPortal,
} from '../src/index.js';
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
const linkCalls: string[] = [];
const trackCalls: { event: string; props: unknown }[] = [];
const analytics: RunAnalytics = { track: (event, props) => trackCalls.push({ event, props }) };

/** Stands in for the ingest client's consent surface (ADR-025); e2e reads `privacyCalls`. */
const privacyCalls: string[] = [];
const preset = q.get('consent');
let consent: PrivacyControls['consent'] = preset === 'yes' || preset === 'no' ? preset : null;
let install: string | null = consent === 'yes' ? 'test-install-0000' : null;
let deletePending = false;
const privacy: PrivacyControls = {
  get deletePending() {
    return deletePending;
  },
  get consent() {
    return consent;
  },
  get install() {
    return install;
  },
  setConsent(yes) {
    privacyCalls.push(yes ? 'yes' : 'no');
    consent = yes ? 'yes' : 'no';
    install = yes ? (install ?? 'test-install-0000') : null;
  },
  deleteData() {
    privacyCalls.push('delete');
    consent = 'no';
    // `deleteFail=1`: the server is unreachable, so the ID is kept and the delete stays pending.
    deletePending = q.get('deleteFail') === '1';
    if (deletePending) return Promise.resolve(false);
    install = null;
    return Promise.resolve(true);
  },
};
const unlockCalls: number[] = [];
/** `rounds=N`: a shorter run with no rush round, so e2e reaches the run end quickly. */
const rounds = Number(q.get('rounds') ?? '0');
const toy = toyRunConfig({ seed, cards: DEV_CARDS });
// The toy's rounds sample District 1's curve (ADR-030): keep one curve round per round played.
const shortRun =
  rounds > 0
    ? { rounds, rushRounds: [], curveRounds: (toy.curveRounds ?? []).slice(0, rounds) }
    : {};

mountGame(document.getElementById('app') as HTMLElement, {
  run: new ControllerRun({
    config: { ...toy, ...shortRun },
    env: devEnv,
    catalog: devCatalog,
    analytics,
  }),
  spawnWorker: sim ? spawnSimWorker : spawnFakeWorker,
  ...(sim ? {} : { layout: tileLaneLayout }),
  config: {
    privacyUrl: q.get('privacy') ?? '',
    shareUrl: q.get('share') ?? '',
    portal: (q.get('portal') ?? 'none') as UiPortal,
    // `extlink=1`: a portal-style link opener (Poki's openExternalLink); e2e reads `linkCalls`.
    ...(q.get('extlink') === '1' ? { openExternalLink: (url: string) => linkCalls.push(url) } : {}),
  },
  ...(q.get('analytics') === '1' ? { privacy } : {}),
  unlock: () => unlockCalls.push(Date.now()),
  sound,
  testHooks: true,
  reducedMotion: q.get('reduced') === '1',
});
Object.assign(window, { soundCalls, trackCalls, privacyCalls, unlockCalls, linkCalls });
