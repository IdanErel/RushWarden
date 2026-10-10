import { NullPortalAdapter } from '@rushwarden/app';
import { Sim, sampleInput } from '@rushwarden/sim';

/**
 * Phase 0 web entry: proves the bundle boots and runs the sim in the browser.
 * The Render and UI engineers replace this with the worker + Pixi scene in Phase 1.
 */
async function boot(): Promise<void> {
  const portal = new NullPortalAdapter();
  await portal.init();
  const result = Sim.simulate(sampleInput(1));
  const el = document.getElementById('app');
  if (el) {
    el.dataset['hash'] = result.finalHash;
    el.textContent = `Rushwarden · sim ok · ${result.ticks} ticks · ${result.finalHash}`;
  }
}

void boot();
