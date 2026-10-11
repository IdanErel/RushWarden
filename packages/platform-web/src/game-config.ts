import type { UiConfig, UiPortal } from '@rushwarden/ui';
import type { WebPortalAdapter } from './portal/types.js';
import { NO_ANALYTICS_PORTALS, privacyUrlFrom } from './portal/flag.js';

/** Build-time settings the run screen reads (see vite-env.d.ts). */
export interface GameBuildEnv {
  /** Privacy policy URL; unset until the policy is published (P1-BE-02, ADR-025 point 5). */
  VITE_PRIVACY_URL?: string | undefined;
}

/**
 * Poki and CrazyGames builds: no unlock button, no price and no links except the portal's own
 * share URL and the privacy policy (ADR-024 points 2, 3 and 5). The toy has no unlock screen and
 * no other links yet; whatever adds one checks this.
 */
export function isPortalBuild(portalId: WebPortalAdapter['id']): boolean {
  return (NO_ANALYTICS_PORTALS as readonly string[]).includes(portalId);
}

/**
 * The run screen's config for this build: the privacy policy link (https only; every build,
 * portals included, per ADR-024 point 5 and ADR-025), the portal's own share link, and outbound
 * links through the portal adapter (Poki: `PokiSDK.openExternalLink`; #59, #63).
 */
export function uiConfigFor(
  env: GameBuildEnv,
  portal: Pick<WebPortalAdapter, 'id' | 'shareUrl' | 'openExternalLink'>,
): UiConfig {
  return {
    privacyUrl: privacyUrlFrom(env),
    shareUrl: portal.shareUrl(),
    openExternalLink: (url) => portal.openExternalLink(url),
    portal: uiPortalFor(portal.id),
  };
}

/**
 * The run screen's portal rules (#71, ADR-024): the web build's portal id as the UI's
 * `UiPortal`. Web builds only ever run the none, itch, Poki and CrazyGames adapters; any other
 * id (store shells) maps to `none`.
 */
export function uiPortalFor(id: WebPortalAdapter['id']): UiPortal {
  return id === 'itch' || id === 'poki' || id === 'crazygames' ? id : 'none';
}
