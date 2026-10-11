export const SDK_URLS: { poki: string; crazygames: string };
export const INERT_URLS: string[];
export const AD_MARKERS: string[];
export function checkPortalFiles(
  portal: 'poki' | 'crazygames',
  files: [string, Buffer][],
  options?: { privacyUrl?: string },
): string[];
