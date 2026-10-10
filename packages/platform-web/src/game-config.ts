import type { UiConfig } from '@rushwarden/ui';
import type { WebPortalAdapter } from './portal/types.js';
import { NO_ANALYTICS_PORTALS } from './portal/flag.js';

/** Build-time settings the run screen reads (see vite-env.d.ts). */
export interface GameBuildEnv {
  /** Privacy policy URL; unset until the policy is published (P1-BE-02). */
  VITE_PRIVACY_URL?: string | undefined;
}

/**
 * Portals whose builds show no outbound link and no unlock (GDD §9 portal rules, ADR-024). The
 * toy has no unlock screen yet; when it gets one, it checks `canSellInPortal()` as well.
 */
export function isPortalBuild(portalId: WebPortalAdapter['id']): boolean {
  return (NO_ANALYTICS_PORTALS as readonly string[]).includes(portalId);
}

/**
 * The run screen's config for this build. Portal builds get no privacy link (the policy lives on
 * our site, which Poki and CrazyGames do not allow linking to) and the portal's own share link.
 */
export function uiConfigFor(
  env: GameBuildEnv,
  portal: Pick<WebPortalAdapter, 'id' | 'shareUrl'>,
): UiConfig {
  const privacy = env.VITE_PRIVACY_URL ?? '';
  return {
    privacyUrl: !isPortalBuild(portal.id) && privacy.startsWith('https://') ? privacy : '',
    shareUrl: portal.shareUrl(),
  };
}
