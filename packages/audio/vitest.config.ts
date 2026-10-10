import { defineConfig } from 'vitest/config';

// GDD section 6: packages other than sim have 70%+ line coverage.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 70 },
    },
  },
});
