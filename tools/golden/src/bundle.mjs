// Bundles the golden runner into one IIFE so Playwright can inject it into any engine.
import { build } from 'esbuild';

await build({
  entryPoints: [new URL('./browser-entry.ts', import.meta.url).pathname],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: new URL('../dist/golden.js', import.meta.url).pathname,
  logLevel: 'warning',
});
