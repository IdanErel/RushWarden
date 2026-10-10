import { NullPortalAdapter } from '@rushwarden/app';
import { Sim, sampleInput } from '@rushwarden/sim';
import { startAnalytics } from './analytics.js';

/**
 * Phase 0 web entry: proves the bundle boots and runs the sim in the browser.
 * The Render and UI engineers replace this with the worker + Pixi scene in Phase 1.
 */
async function boot(): Promise<void> {
  const portal = new NullPortalAdapter();
  await portal.init();
  const t0 = performance.now();
  const result = Sim.simulate(sampleInput(1));
  const benchmarkMs = performance.now() - t0;
  const el = document.getElementById('app');
  if (el) {
    el.dataset['hash'] = result.finalHash;
    el.textContent = `Rushwarden · sim ok · ${result.ticks} ticks · ${result.finalHash}`;
  }
  // Off unless the build sets VITE_INGEST_URL (ADR-007: not in public builds before the policy).
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch {
    // Storage blocked in this frame.
  }
  const analytics = startAnalytics(import.meta.env, benchmarkMs, {
    storage,
    language: navigator.language,
  });
  analytics.track('app_open', {});
}

void boot();
