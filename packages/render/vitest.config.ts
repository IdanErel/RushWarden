import { defineConfig } from 'vitest/config';

// GDD section 6: packages other than sim keep 70%+ line coverage. The Pixi layer and the worker
// entry need a browser; they are exercised by the dev-page Playwright check (e2e/scene.spec.ts).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/pixi/**', 'src/worker/*.worker.ts', 'src/index.ts'],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 70 },
    },
  },
});
