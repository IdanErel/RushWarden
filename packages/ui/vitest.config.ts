import { defineConfig } from 'vitest/config';

// GDD section 6: 70%+ line coverage outside the sim. The Preact screens need a browser and are
// covered by the dev-page Playwright flow (e2e/run.spec.ts).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 70 },
    },
  },
});
