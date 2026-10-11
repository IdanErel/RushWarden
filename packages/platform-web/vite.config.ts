import { defineConfig, loadEnv } from 'vite';
import { checkBuildEnv } from './src/portal/flag.js';

export default defineConfig(({ mode }) => {
  // Fail the build on an unknown portal flag instead of silently shipping the wrong adapter, on a
  // portal build that sets VITE_INGEST_URL (ADR-024 point 4), and on any build that sets it without
  // an https VITE_PRIVACY_URL (ADR-025 point 5). loadEnv includes process.env.
  checkBuildEnv(loadEnv(mode, '.', 'VITE_'));
  return {
    base: './',
    build: { target: 'es2022', sourcemap: false },
    // The sim worker (`spawnSimWorker`) is an ES module worker.
    worker: { format: 'es' },
  };
});
