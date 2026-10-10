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
