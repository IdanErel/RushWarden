/**
 * The portal build flag. Set `VITE_PORTAL` at build time (`pnpm build:poki` and friends); unset
 * means `none` (own site, dev, e2e). Kept free of DOM code so `vite.config.ts` can import it.
 */
export const PORTAL_FLAGS = ['none', 'itch', 'poki', 'crazygames'] as const;
export type PortalFlag = (typeof PORTAL_FLAGS)[number];

/** Share URL when `VITE_SHARE_URL` is not set (ADR-008 domain). */
export const DEFAULT_SHARE_URL = 'https://rushwarden.com/';

/** Parses the flag; throws on an unknown value so a typo fails the build instead of shipping. */
export function parsePortalFlag(value: string | undefined): PortalFlag {
  if (value === undefined || value === '') return 'none';
  if ((PORTAL_FLAGS as readonly string[]).includes(value)) return value as PortalFlag;
  throw new Error(`VITE_PORTAL must be one of ${PORTAL_FLAGS.join(', ')}; got "${value}"`);
}

/** Portals whose builds collect nothing (ADR-024 point 4, ADR-025 point 3). */
export const NO_ANALYTICS_PORTALS: readonly PortalFlag[] = ['poki', 'crazygames'];

/** Portals whose builds link only to the portal's own share URL and the privacy policy (ADR-024 point 5). */
export const PORTAL_LINKS_ONLY: readonly PortalFlag[] = ['poki', 'crazygames'];

/**
 * The build's privacy policy URL (`VITE_PRIVACY_URL`) when it is an absolute https URL, else `''`
 * (not published yet). The one reading of the variable for the UI, analytics and the build check.
 */
export function privacyUrlFrom(env: { readonly VITE_PRIVACY_URL?: string | undefined }): string {
  const url = env.VITE_PRIVACY_URL ?? '';
  try {
    return new URL(url).protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

/**
 * Build check run by `vite.config.ts`: parses `VITE_PORTAL` and fails the build when
 * - a portal build sets `VITE_INGEST_URL`, so a Poki or CrazyGames bundle can never contain our
 *   endpoint (ADR-024 point 4, ADR-025 point 3);
 * - any build sets `VITE_INGEST_URL` without an https `VITE_PRIVACY_URL`: collection may only be
 *   switched on once the policy is published and linked (ADR-025 point 5);
 * - a portal build sets `VITE_SHARE_URL`: portal builds share only the portal's own URL
 *   (ADR-024 point 5).
 */
export function checkBuildEnv(env: Readonly<Record<string, string | undefined>>): PortalFlag {
  const portal = parsePortalFlag(env['VITE_PORTAL']);
  const ingest = (env['VITE_INGEST_URL'] ?? '') !== '';
  if (NO_ANALYTICS_PORTALS.includes(portal) && ingest)
    throw new Error(
      `VITE_INGEST_URL must not be set in a ${portal} build: portal builds collect nothing (ADR-024 point 4, ADR-025 point 3)`,
    );
  if (ingest && privacyUrlFrom({ VITE_PRIVACY_URL: env['VITE_PRIVACY_URL'] }) === '')
    throw new Error(
      'VITE_INGEST_URL needs an https VITE_PRIVACY_URL: analytics stays off until the privacy policy is published and linked (ADR-025 point 5)',
    );
  if (PORTAL_LINKS_ONLY.includes(portal) && (env['VITE_SHARE_URL'] ?? '') !== '')
    throw new Error(
      `VITE_SHARE_URL must not be set in a ${portal} build: portal builds share only the portal's own URL (ADR-024 point 5)`,
    );
  return portal;
}
