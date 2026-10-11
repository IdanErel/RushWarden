// P1-PLT-02: checks on the Poki and CrazyGames artifacts, on top of the itch checks (index.html at
// the root, relative URLs, no source maps, no test hooks). Kept apart from package-portal.mjs so
// they are unit-tested. Any error fails `pnpm package:poki` / `pnpm package:crazygames`.
import { checkItchFiles } from './itch-checks.mjs';

/** Each portal's SDK script, the only network request a portal build makes (ADR-024 point 4). */
export const SDK_URLS = {
  poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
};

/**
 * URL strings a portal bundle may contain that are not links and are never fetched. Anything else
 * fails the package: ADR-024 point 5 allows only the portal's own share URL (given by its SDK at
 * runtime, so never in the bundle) and the privacy policy (`VITE_PRIVACY_URL`, passed in).
 */
export const INERT_URLS = [
  // JSON Schema `$schema` and `$id` of the content schemas (identifiers, not fetched).
  'https://json-schema.org/draft/2020-12/schema',
  'https://rushwarden.com/schema/card.schema.json',
  'https://rushwarden.com/schema/deck.schema.json',
  'https://rushwarden.com/schema/map.schema.json',
  // XML namespaces in the DOM and Pixi code.
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/2000/svg',
  // Pixi's console banner.
  'http://www.pixijs.com/',
];

/**
 * Ad API names that must never appear (ADR-013, ADR-024 decision 1). `commercialBreak` is not
 * here: it is our own adapter method, which resolves without calling the SDK (unit-tested, and
 * the package e2e records every SDK call). `requestAd(` with the parenthesis, so WebGPU's
 * `requestAdapter` does not match.
 */
export const AD_MARKERS = [
  'rewardedBreak',
  'requestAd(',
  'requestBanner',
  'requestResponsiveBanner',
];

const TEXT = /\.(?:html|js|mjs|css|json|svg|txt)$/;
const URL_RE = /https?:\/\/[^\s"'`<>()\\,;{}]+/g;

/**
 * @param {'poki' | 'crazygames'} portal
 * @param {[string, Buffer][]} files zip-relative names and contents
 * @param {{ privacyUrl?: string }} [options] the build's `VITE_PRIVACY_URL`, if set
 * @returns {string[]} errors
 */
export function checkPortalFiles(portal, files, options = {}) {
  const errors = checkItchFiles(files);
  const allowed = new Set([SDK_URLS[portal], ...INERT_URLS]);
  if (options.privacyUrl) allowed.add(options.privacyUrl);
  let sdk = false;
  for (const [name, data] of files) {
    if (!TEXT.test(name)) continue;
    const text = data.toString('utf8');
    for (const m of new Set(text.match(URL_RE) ?? [])) {
      if (m === SDK_URLS[portal]) sdk = true;
      if (!allowed.has(m))
        errors.push(`${name} has a URL that is not approved for ${portal}: ${m}`);
    }
    for (const marker of AD_MARKERS)
      if (text.includes(marker)) errors.push(`${name} contains an ad API call (${marker})`);
  }
  if (!sdk) errors.push(`no ${portal} SDK URL in the bundle: is this a ${portal} build?`);
  return errors;
}
