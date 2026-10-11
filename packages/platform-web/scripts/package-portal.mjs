// P1-PLT-02: packages the Poki or CrazyGames build as the zip Idan uploads, and checks it. Run via
// `pnpm package:poki` / `pnpm package:crazygames`, which build that flavour into
// node_modules/.<portal>-dist first. Uploading is Idan's (GDD §13): this only writes
// portals/rushwarden-<portal>.zip.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkZipSize, ZIP_LIMIT } from './itch-checks.mjs';
import { checkPortalFiles, SDK_URLS } from './portal-checks.mjs';
import { listFiles, zipDirectory } from './zip.mjs';

const portal = process.argv[2];
if (!(portal in SDK_URLS)) {
  console.error(`usage: node scripts/package-portal.mjs ${Object.keys(SDK_URLS).join('|')}`);
  process.exit(2);
}
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(pkg, 'node_modules', `.${portal}-dist`);
const out = join(pkg, 'portals', `rushwarden-${portal}.zip`);
const MB = 1024 * 1024;

const files = listFiles(dist);
const zip = zipDirectory(dist);
const privacyUrl = process.env.VITE_PRIVACY_URL ?? '';
const errors = [
  ...checkPortalFiles(
    portal,
    files.map(([name, path]) => [name, readFileSync(path)]),
    privacyUrl ? { privacyUrl } : {},
  ),
  ...checkZipSize(zip.length),
];

if (errors.length) {
  // A failing artifact is never written.
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zip);
const summary = `${files.length} files, ${(zip.length / MB).toFixed(3)} MB (budget ${ZIP_LIMIT / MB} MB)`;
console.log(`${portal} zip: ${out}`);
console.log(`  ${summary}`);
for (const [n] of files) console.log(`  ${n}`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${portal} zip\n\n${summary}\n`);
