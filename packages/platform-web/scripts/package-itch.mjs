// P1-PLT-01: packages the itch build as the itch.io HTML5 zip and checks it. Run via
// `pnpm package:itch`, which builds the itch flavour into node_modules/.itch-dist first (never
// dist/, which e2e previews). Deploying with butler is the Lead's (P1-LEAD-02); this only
// produces itch/rushwarden-itch.zip.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkItchFiles, checkZipSize, ZIP_LIMIT } from './itch-checks.mjs';
import { listFiles, zipDirectory } from './zip.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(pkg, 'node_modules', '.itch-dist');
const out = join(pkg, 'itch', 'rushwarden-itch.zip');
const MB = 1024 * 1024;

const files = listFiles(dist);
const zip = zipDirectory(dist);
const errors = [
  ...checkItchFiles(files.map(([name, path]) => [name, readFileSync(path)])),
  ...checkZipSize(zip.length),
];

if (errors.length) {
  // A failing artifact is never written, so CI cannot upload it.
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zip);
console.log(`itch zip: ${out}`);
console.log(
  `  ${files.length} files, ${(zip.length / MB).toFixed(3)} MB (budget ${ZIP_LIMIT / MB} MB)`,
);
for (const [n] of files) console.log(`  ${n}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### itch zip\n\n${files.length} files, ${(zip.length / MB).toFixed(3)} MB (budget ${ZIP_LIMIT / MB} MB)\n`,
  );
}
