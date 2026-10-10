// Bundles the CLI and the worker-thread entry into dist/ so plain Node can run them (the
// workspace packages export TypeScript sources).
import { build } from 'esbuild';

await build({
  entryPoints: {
    cli: new URL('../src/cli.ts', import.meta.url).pathname,
    worker: new URL('../src/worker.ts', import.meta.url).pathname,
  },
  bundle: true,
  // Resolved from node_modules at run time (repo dev tooling), not bundled.
  external: ['prettier'],
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: new URL('../dist', import.meta.url).pathname,
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});
