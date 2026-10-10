// P1-PLT-01: checks on the itch artifact's files, kept apart from package-itch.mjs so they are
// unit-tested. Each check returns readable errors; any error fails `pnpm package:itch`.

const MB = 1024 * 1024;
/** ADR-004 budget for the initial download; itch's own limits are far above it. */
export const ZIP_LIMIT = 7.5 * MB;
export const MAX_FILES = 1000;

/**
 * Strings that only test-hook builds contain (#22, H1/H4). Minifiers keep string literals, so
 * these survive a production build if the hooks leak in.
 */
export const HOOK_MARKERS = ['__portalCalls', 'portalSpy'];

const TEXT = /\.(?:html|js|mjs|css|json|svg|txt)$/;

/**
 * @param {[string, Buffer][]} files zip-relative names and contents
 * @returns {string[]} errors
 */
export function checkItchFiles(files) {
  const errors = [];
  const names = files.map(([n]) => n);
  if (!names.includes('index.html')) errors.push('index.html must be at the root of the zip');
  if (files.length > MAX_FILES) errors.push(`${files.length} files; itch allows ${MAX_FILES}`);
  for (const [name, data] of files) {
    if (name.endsWith('.map')) errors.push(`source map in the artifact: ${name}`);
    if (!TEXT.test(name)) continue;
    const text = data.toString('utf8');
    if (text.includes('sourceMappingURL')) errors.push(`${name} references a source map`);
    for (const marker of HOOK_MARKERS)
      if (text.includes(marker)) errors.push(`${name} contains test-hook code (${marker})`);
    // itch serves the game from a CDN subfolder inside an iframe, so every URL in index.html must
    // be relative (vite `base: './'`).
    if (name === 'index.html') {
      const absolute = [...text.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
      if (absolute.length) errors.push(`index.html has root-absolute URLs: ${absolute.join(', ')}`);
    }
  }
  return errors;
}

/** @param {number} bytes */
export function checkZipSize(bytes) {
  return bytes > ZIP_LIMIT
    ? [`zip is ${(bytes / MB).toFixed(3)} MB; budget ${ZIP_LIMIT / MB} MB`]
    : [];
}
