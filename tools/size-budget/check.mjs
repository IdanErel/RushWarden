// Web download budget (GDD section 6, ADR-004). Gzips every file in the web build and fails when
// the initial download or the total exceeds its limit. Files under dist/lazy/ are lazy-loaded
// (districts 2-3, share encoder) and count only toward the total.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const MB = 1024 * 1024;
const INITIAL_LIMIT = 7.5 * MB;
const INITIAL_TARGET = 4 * MB;
const TOTAL_LIMIT = 12 * MB;

const dist =
  process.argv[2] ?? new URL('../../packages/platform-web/dist', import.meta.url).pathname;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let initial = 0;
let total = 0;
const rows = [];
for (const file of walk(dist)) {
  const rel = relative(dist, file);
  const gz = gzipSync(readFileSync(file), { level: 9 }).length;
  total += gz;
  if (!rel.startsWith('lazy/')) initial += gz;
  rows.push([rel, gz]);
}
rows.sort((a, b) => b[1] - a[1]);

const fmt = (n) => `${(n / MB).toFixed(3)} MB`;
console.log('Largest files (gzipped):');
for (const [rel, gz] of rows.slice(0, 10)) console.log(`  ${fmt(gz).padStart(12)}  ${rel}`);
console.log(
  `Initial: ${fmt(initial)} (limit ${fmt(INITIAL_LIMIT)}, target ${fmt(INITIAL_TARGET)})`,
);
console.log(`Total:   ${fmt(total)} (limit ${fmt(TOTAL_LIMIT)})`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Web bundle budget\n\n| | gzipped | limit |\n|---|---|---|\n| Initial | ${fmt(initial)} | ${fmt(INITIAL_LIMIT)} |\n| Total | ${fmt(total)} | ${fmt(TOTAL_LIMIT)} |\n`,
  );
}

let failed = false;
if (initial > INITIAL_LIMIT) {
  console.error(`FAIL: initial download ${fmt(initial)} exceeds ${fmt(INITIAL_LIMIT)}`);
  failed = true;
}
if (total > TOTAL_LIMIT) {
  console.error(`FAIL: total download ${fmt(total)} exceeds ${fmt(TOTAL_LIMIT)}`);
  failed = true;
}
if (initial > INITIAL_TARGET)
  console.warn(`WARN: initial download is above the ${fmt(INITIAL_TARGET)} target`);
process.exit(failed ? 1 : 0);
