import { defineConfig } from 'vitest/config';

// GDD section 6: packages/sim has 90%+ line coverage.
export default defineConfig({
  test: {
    // Property tests under coverage take a few seconds; the default 5 s flakes on a loaded core.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
