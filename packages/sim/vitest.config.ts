import { defineConfig } from 'vitest/config';

// GDD section 6: packages/sim has 90%+ line coverage.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
