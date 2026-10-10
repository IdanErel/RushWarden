import { defineConfig } from 'vite';

// Dev page only (`pnpm dev`, `pnpm dev:build`); the shipped game is bundled by platform-web.
export default defineConfig({
  root: 'dev',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
});
