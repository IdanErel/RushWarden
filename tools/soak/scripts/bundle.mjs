// Bundles the CLI into dist/ so plain Node can run it (the workspace packages export TypeScript
// sources). Same approach as packages/balance.
import { build } from 'esbuild';

await build({
  entryPoints: { cli: new URL('../src/cli.ts', import.meta.url).pathname },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: new URL('../dist', import.meta.url).pathname,
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});
