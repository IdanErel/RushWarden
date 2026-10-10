import { defineConfig, loadEnv } from 'vite';
import { parsePortalFlag } from './src/portal/flag.js';

export default defineConfig(({ mode }) => {
  // Fail the build on an unknown portal flag instead of silently shipping the wrong adapter.
  parsePortalFlag(loadEnv(mode, '.', 'VITE_')['VITE_PORTAL']);
  return {
    base: './',
    build: { target: 'es2022', sourcemap: false },
    // The sim worker (`spawnSimWorker`) is an ES module worker.
    worker: { format: 'es' },
  };
});
