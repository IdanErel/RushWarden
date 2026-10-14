/**
 * Run screen dev page: the real run controller (P1-BAL-01) with dev stand-in cards, fake traffic
 * in the worker (or `source=sim`), test hooks on. Query: `seed` (H1-style run seed), `privacy`
 * (policy URL), `share` (share URL), `rounds`, `hand`, `reduced=1`, `jam=1`, `source=sim`, `portal` (`poki`,
 * `crazygames`, ...), `analytics=1` (a stand-in consent surface; `consent=yes|no` presets the
 * answer, `deleteFail=1` fails the delete). Sound is the real engine; e2e reads `playCalls`. Not shipped; Platform mounts the game in platform-web.
 */
import { toyRunConfig, type RunAnalytics } from '@rushwarden/app';
import { spawnSimWorker, tileLaneLayout } from '@rushwarden/render';
import { spawnFakeWorker } from '@rushwarden/render/fake-worker';
import {
  ControllerRun,
  createGameSound,
  mountGame,
  type PrivacyControls,
  type SoundControl,
  type UiPortal,
} from '../src/index.js';
import { fitNames } from '../src/fit-text.js';
import { displayName } from '../src/names.js';
import { DEV_CARDS, DEV_STARTING_DECK, devCatalog, devEnv } from './cards.js';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? '1') >>> 0;
const sim = q.get('source') === 'sim';

/**
 * The real sound (`createGameSound`: Web Audio, saved choice, gesture unlock), with its toggle
 * calls (the gesture rule, AUD note on PR #15) and plays recorded for e2e. A play records
 * whether the engine actually played it (false before audio starts or while muted).
 */
const soundCalls: boolean[] = [];
const playCalls: { id: string; played: boolean; t: number }[] = [];
const real = createGameSound();
const sound: SoundControl = {
  get muted() {
    return real.muted;
  },
  get started() {
    return real.started ?? false;
  },
  setSoundOnFromGesture(on: boolean) {
    soundCalls.push(on);
    return real.setSoundOnFromGesture(on);
  },
  play(id, options) {
    const played = real.play?.(id, options) ?? false;
    playCalls.push({ id, played, t: performance.now() });
    return played;
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
// The dev page pins its own deck and card pool on top of the toy preset, past the toy's card
// exclusions (ADR-032 E1), so content's toy deck never moves the dev page's round seeds.
const toy = {
  ...toyRunConfig({ seed, cards: DEV_CARDS }),
  cards: DEV_CARDS,
  startingDeck: DEV_STARTING_DECK,
};
// The toy's rounds sample District 1's curve (ADR-030): keep one curve round per round played.
const shortRun =
  rounds > 0
    ? { rounds, rushRounds: [], curveRounds: (toy.curveRounds ?? []).slice(0, rounds) }
    : {};

/** `hand=N`: deal N cards a round (a Second Shift hand of 7 from round 1, for U10's e2e). */
const handSize = Number(q.get('hand') ?? '0');
const bigHand = handSize > 0 ? { handSize } : {};

const run = new ControllerRun({
  config: { ...toy, ...shortRun, ...bigHand },
  env: devEnv,
  catalog: devCatalog,
  analytics,
});
// `jam=1`: every round runs the fake traffic in Gridlock Drill jam mode, so it gridlocks (the
// gridlock origin ring and result line). Fake traffic only; the sim ignores the boss name here.
if (q.get('jam') === '1' && !sim) {
  const input = run.roundInput.bind(run);
  run.roundInput = () => {
    const i = input();
    return { ...i, districtRules: { ...i.districtRules, boss: 'gridlock-drill' } };
  };
}

mountGame(document.getElementById('app') as HTMLElement, {
  run,
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
Object.assign(window, {
  // e2e: sets any card names into the hand and fits them (layout.spec name checks).
  fitNames,
  displayName,
  soundCalls,
  playCalls,
  trackCalls,
  privacyCalls,
  unlockCalls,
  linkCalls,
});
