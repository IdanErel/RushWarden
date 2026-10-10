import { defineConfig } from 'vite';

// The clip page: the scene, the HUD and the replay in one bundle, driven frame by frame by
// cli/render.ts. Not shipped in any game build.
export default defineConfig({
  root: 'page',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
});
