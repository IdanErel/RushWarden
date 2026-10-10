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

/**
 * Build check run by `vite.config.ts`: parses `VITE_PORTAL` and fails the build when a portal
 * build sets `VITE_INGEST_URL`, so a Poki or CrazyGames bundle can never contain our endpoint.
 */
export function checkBuildEnv(env: Readonly<Record<string, string | undefined>>): PortalFlag {
  const portal = parsePortalFlag(env['VITE_PORTAL']);
  if (NO_ANALYTICS_PORTALS.includes(portal) && (env['VITE_INGEST_URL'] ?? '') !== '')
    throw new Error(
      `VITE_INGEST_URL must not be set in a ${portal} build: portal builds collect nothing (ADR-024 point 4, ADR-025 point 3)`,
    );
  return portal;
}
