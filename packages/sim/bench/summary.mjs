/**
 * Turns `vitest bench --outputJson` results into a Markdown table of rounds per second (one
 * `Sim.simulate` call per sample, so hz = rounds/s), with the GDD section 3 budget: "at least
 * 2,000 full 300-tick rounds per second… single core, with up to 150 vehicles". Report only; it
 * never fails the build. Usage: node bench/summary.mjs <results.json> [summary.md]
 */
import { appendFileSync, readFileSync } from 'node:fs';

const BUDGET = 2000;
const [input, output] = process.argv.slice(2);
if (!input) throw new Error('usage: node bench/summary.mjs <results.json> [summary.md]');
const { files } = JSON.parse(readFileSync(input, 'utf8'));
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const lines = [
  '## Sim throughput (report only, GDD section 3 budget: 2,000 rounds/s at 150 vehicles)',
  '',
  '| Mix | Round | Rounds/s (mean) | Rounds/s (median) | ±% | vs budget |',
  '| --- | --- | ---: | ---: | ---: | --- |',
];
for (const file of files) {
  for (const group of file.groups) {
    const mix = group.fullName.split(' > ').pop().replace(/^mix /, '');
    for (const b of group.benchmarks) {
      const median = 1000 / b.median;
      const budget = / 150 vehicles$/.test(b.name)
        ? `${b.hz >= BUDGET ? 'meets' : 'below'} (${fmt((b.hz / BUDGET) * 100)}%)`
        : '';
      lines.push(
        `| ${mix} | ${b.name} | ${fmt(b.hz)} | ${fmt(median)} | ${b.rme.toFixed(1)} | ${budget} |`,
      );
    }
  }
}
lines.push(
  '',
  `Node ${process.version}, ${process.platform}/${process.arch}. "cache miss" rows include a map clone.`,
  '',
);
const md = lines.join('\n');
console.log(md);
if (output) appendFileSync(output, md);
