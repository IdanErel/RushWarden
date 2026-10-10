/**
 * `pnpm clip`: renders one round of a seeded toy run to a 9:16 MP4 and GIF (P1-QA-02). See
 * `--help` and tools/clip/README.md.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs, USAGE } from './args.ts';
import { PKG_DIR, renderClip } from './render.ts';

// pnpm runs package scripts in the package directory; paths the user typed are relative to
// where they typed them.
const cwd = process.env['INIT_CWD'] ?? process.cwd();
const at = (p: string): string => (isAbsolute(p) ? p : resolve(cwd, p));

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const parsed = parseArgs(argv, (p) => JSON.parse(readFileSync(at(p), 'utf8')) as unknown);
  if (!parsed) {
    console.log(USAGE);
    return;
  }
  const outDir = argv.includes('--out') ? at(parsed.outDir) : join(PKG_DIR, 'out');
  const t0 = Date.now();
  const out = await renderClip(
    { ...parsed, outDir },
    { progress: (d, n) => process.stdout.write(`\rframes ${d}/${n}`) },
    ...(parsed.workers ? [parsed.workers] : []),
  );
  process.stdout.write('\n');
  const r = out.meta.result;
  console.log(
    `round ${out.meta.round}: ${r.throughput} through / quota ${out.meta.quota}` +
      `${r.gridlocked ? ` (gridlock at tick ${r.ticks})` : ''}; cards: ${out.meta.cardsPlayed.join(', ') || 'none'}`,
  );
  for (const [k, f] of Object.entries(out.files))
    console.log(
      `${k.padEnd(4)} ${relative(cwd, f)}${k in out.sha256 ? `  sha256 ${out.sha256[k as 'mp4' | 'gif']}` : ''}`,
    );
  console.log(
    `frames sha256 ${out.framesSha256} (${out.width}x${out.height}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
