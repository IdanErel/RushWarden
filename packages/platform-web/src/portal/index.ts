import { NullPortalAdapter } from '@rushwarden/app';
import { CrazyGamesAdapter } from './crazygames.js';
import { ItchAdapter } from './itch.js';
import { PokiAdapter } from './poki.js';
import { browserEnv } from './env.js';
import { isHttpsUrl, type WebAdapterOptions, type WebPortalAdapter } from './types.js';

export { CrazyGamesAdapter, CRAZYGAMES_SDK_URL } from './crazygames.js';
export { ItchAdapter } from './itch.js';
export { PokiAdapter, POKI_SDK_URL } from './poki.js';
export { DEFAULT_SHARE_URL, PORTAL_FLAGS, parsePortalFlag, type PortalFlag } from './flag.js';
export { loadScript, withTimeout, SDK_TIMEOUT_MS } from './load-script.js';
export type { AdapterEnv, WebAdapterOptions, WebPortalAdapter } from './types.js';

/** `NullPortalAdapter` with the web-only hooks; links open in a plain new tab. */
class NoPortalAdapter extends NullPortalAdapter implements WebPortalAdapter {
  loadingFinished(): void {}
  openExternalLink(url: string): void {
    if (isHttpsUrl(url)) browserEnv().openWindow?.(url);
  }
}

/**
 * Picks the adapter for this build's `VITE_PORTAL` flag (validated by `vite.config.ts`). Vite
 * inlines the flag as a string literal, so the bundler drops the other adapters from the build:
 * a Poki build contains only the Poki adapter and only the Poki SDK URL.
 */
export function createPortalAdapter(options: WebAdapterOptions): WebPortalAdapter {
  const flag = import.meta.env.VITE_PORTAL;
  if (flag === 'poki') return new PokiAdapter(options);
  if (flag === 'crazygames') return new CrazyGamesAdapter(options);
  if (flag === 'itch') return new ItchAdapter(options);
  return new NoPortalAdapter(options.shareUrl);
}
