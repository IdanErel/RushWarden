// P1-PLT-01: packages the built web game (dist/) as the itch.io HTML5 zip and checks it.
// Run via `pnpm package:itch`, which builds the itch flavour first. Deploying with butler is the
// Lead's (P1-LEAD-02); this only produces itch/rushwarden-itch.zip.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, zipDirectory } from './zip.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(pkg, 'dist');
const out = join(pkg, 'itch', 'rushwarden-itch.zip');

const MB = 1024 * 1024;
// ADR-004 budget for the initial download; itch's own limits (1000 files, 200 MB per file) are far
// above this, but we check the file count too.
const ZIP_LIMIT = 7.5 * MB;
const MAX_FILES = 1000;

const files = listFiles(dist);
const names = files.map(([n]) => n);
const errors = [];
if (!names.includes('index.html')) errors.push('index.html must be at the root of the zip');
if (files.length > MAX_FILES) errors.push(`${files.length} files; itch allows ${MAX_FILES}`);

// itch serves the game from a subfolder on its CDN inside an iframe, so every URL in index.html
// must be relative (vite `base: './'`).
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const absolute = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
if (absolute.length) errors.push(`index.html has root-absolute URLs: ${absolute.join(', ')}`);

const zip = zipDirectory(dist);
if (zip.length > ZIP_LIMIT)
  errors.push(`zip is ${(zip.length / MB).toFixed(3)} MB; budget ${ZIP_LIMIT / MB} MB`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zip);
console.log(`itch zip: ${out}`);
console.log(
  `  ${files.length} files, ${(zip.length / MB).toFixed(3)} MB (budget ${ZIP_LIMIT / MB} MB)`,
);
for (const n of names) console.log(`  ${n}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### itch zip\n\n${files.length} files, ${(zip.length / MB).toFixed(3)} MB (budget ${ZIP_LIMIT / MB} MB)\n`,
  );
}
if (errors.length) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}
