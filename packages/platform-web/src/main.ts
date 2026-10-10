import { Sim, sampleInput } from '@rushwarden/sim';
import { DEFAULT_SHARE_URL, createPortalAdapter } from './portal/index.js';
import { TEST_HOOKS_ENABLED, seedOverride, withPortalSpy } from './test-hooks.js';

/**
 * Phase 0 web entry: proves the bundle boots and runs the sim in the browser.
 * The Render and UI engineers replace the sim/DOM part with the worker + Pixi scene in Phase 1.
 * The portal adapter is chosen by the `VITE_PORTAL` build flag (see src/portal/flag.ts).
 */
async function boot(): Promise<void> {
  // H4: in hooks builds the adapter is wrapped in a spy that records calls on window.
  // The TEST_HOOKS_ENABLED checks are literal after Vite's inlining, so public builds drop the hooks.
  const adapter = createPortalAdapter({
    shareUrl: import.meta.env.VITE_SHARE_URL || DEFAULT_SHARE_URL,
  });
  const portal = TEST_HOOKS_ENABLED ? withPortalSpy(adapter, location.search, window) : adapter;
  await portal.init();
  // H1: `?seed=<u32>` fixes the seed in hooks builds; the run controller will use the same call.
  const seed = (TEST_HOOKS_ENABLED ? seedOverride(location.search) : null) ?? 1;
  const result = Sim.simulate(sampleInput(seed));
  const el = document.getElementById('app');
  if (el) {
    el.dataset['hash'] = result.finalHash;
    el.dataset['portal'] = portal.id;
    el.dataset['seed'] = String(seed);
    el.textContent = `Rushwarden · sim ok · ${result.ticks} ticks · ${result.finalHash}`;
  }
  portal.loadingFinished();
}

void boot();
