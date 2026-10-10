import { defineConfig } from 'vitest/config';

// GDD section 6: packages other than sim keep 70%+ line coverage. The Pixi page and the Node CLI
// need a browser and ffmpeg; the Playwright check (e2e/clip.spec.ts) exercises them.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The director and clip-model tests play whole rounds; the default 5 s flakes under a parallel
    // `pnpm test` on a loaded machine (the same fix as golden and content in this PR).
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 70 },
    },
  },
});
