import { toyRunConfig } from '@rushwarden/app';
import { cardText, getCard, loadCards, setupRound, startingDeck } from '@rushwarden/content';
import { spawnSimWorker } from '@rushwarden/render';
import { Sim, sampleInput } from '@rushwarden/sim';
import { ControllerRun, mountGame, type CardCatalog } from '@rushwarden/ui';
import { startAnalytics } from './analytics.js';
import { uiConfigFor } from './game-config.js';
import { DEFAULT_SHARE_URL, createPortalAdapter } from './portal/index.js';
import { TEST_HOOKS_ENABLED, seedOverride, withPortalSpy } from './test-hooks.js';

/**
 * Phase 1 web entry (P1-WEB-01): the toy run. The run screen (`@rushwarden/ui`) drives the run
 * controller (`@rushwarden/app`) over content's cards, starting deck and round setup (maps,
 * demand, closures, district rules); the sim runs in a worker and the renderer draws it. The
 * portal adapter is chosen by the `VITE_PORTAL` build flag (see src/portal/flag.ts).
 */

/** Card names and generated rules text (CON-01) for the run screen. */
const catalog: CardCatalog = (id, tier) => {
  const card = getCard(id);
  return { name: card.name, text: cardText(card, tier) };
};

/** A fresh run seed per page load; H1 (`?seed=<u32>`) fixes it in hooks builds. */
function runSeed(): number {
  const fixed = TEST_HOOKS_ENABLED ? seedOverride(location.search) : null;
  if (fixed !== null) return fixed;
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

function localStore(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null; // Storage blocked in this frame.
  }
}

async function boot(): Promise<void> {
  // H4: in hooks builds the adapter is wrapped in a spy that records calls on window.
  // The TEST_HOOKS_ENABLED checks are literal after Vite's inlining, so public builds drop the hooks.
  const adapter = createPortalAdapter({
    shareUrl: import.meta.env.VITE_SHARE_URL || DEFAULT_SHARE_URL,
  });
  const portal = TEST_HOOKS_ENABLED ? withPortalSpy(adapter, location.search, window) : adapter;
  await portal.init();

  // Device class for analytics (GDD §10 "by benchmark"): one headless sim round.
  const t0 = performance.now();
  Sim.simulate(sampleInput(1));
  const benchmarkMs = performance.now() - t0;
  // Off unless the build sets VITE_INGEST_URL (ADR-007) and never on portals (ADR-024/025); even
  // then nothing is sent until the player says yes (ADR-025: consent is off by default).
  const analytics = startAnalytics(import.meta.env, portal.id, benchmarkMs, {
    storage: localStore(),
    language: navigator.language,
  });

  const seed = runSeed();
  const el = document.getElementById('app');
  if (!el) return;
  el.dataset['portal'] = portal.id;
  el.dataset['seed'] = String(seed);
  el.removeAttribute('aria-live'); // The run screen has its own live regions.
  el.textContent = '';

  const run = new ControllerRun({
    config: toyRunConfig({ seed, cards: loadCards(), startingDeck: startingDeck() }),
    env: { setupRound },
    catalog,
    analytics,
  });
  mountGame(el, {
    run,
    spawnWorker: spawnSimWorker,
    config: uiConfigFor(import.meta.env, portal),
    installId: () => analytics.install,
    testHooks: TEST_HOOKS_ENABLED,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    // GDD §9 portal call pattern. commercialBreak never shows an ad (ADR-013, ADR-024): the
    // adapters resolve it without calling any ad API.
    events: {
      roundStart: () => portal.gameplayStart(),
      roundEnd: () => portal.gameplayStop(),
      runEnd: (s) => {
        if (s.won) portal.happyTime();
        void portal.commercialBreak();
      },
      runStart: () => void portal.commercialBreak(),
    },
  });
  portal.loadingFinished();
  analytics.track('app_open', {});
  // Before the first run (§9); the run screen is already interactive.
  await portal.commercialBreak();
}

void boot();
