import { Sim, sampleInput } from '@rushwarden/sim';
import { startAnalytics } from './analytics.js';
import { DEFAULT_SHARE_URL, createPortalAdapter } from './portal/index.js';

/**
 * Phase 0 web entry: proves the bundle boots and runs the sim in the browser.
 * The Render and UI engineers replace the sim/DOM part with the worker + Pixi scene in Phase 1.
 * The portal adapter is chosen by the `VITE_PORTAL` build flag (see src/portal/flag.ts).
 */
async function boot(): Promise<void> {
  const portal = createPortalAdapter({
    shareUrl: import.meta.env.VITE_SHARE_URL || DEFAULT_SHARE_URL,
  });
  await portal.init();
  const t0 = performance.now();
  const result = Sim.simulate(sampleInput(1));
  const benchmarkMs = performance.now() - t0;
  const el = document.getElementById('app');
  if (el) {
    el.dataset['hash'] = result.finalHash;
    el.dataset['portal'] = portal.id;
    el.textContent = `Rushwarden · sim ok · ${result.ticks} ticks · ${result.finalHash}`;
  }
  portal.loadingFinished();
  // Off unless the build sets VITE_INGEST_URL (ADR-007: not in public builds before the policy),
  // and even then nothing is sent until the player says yes (ADR-025; the prompt is UI's).
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch {
    // Storage blocked in this frame.
  }
  const analytics = startAnalytics(import.meta.env, portal.id, benchmarkMs, {
    storage,
    language: navigator.language,
  });
  analytics.track('app_open', {});
}

void boot();
