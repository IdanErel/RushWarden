import { defineConfig } from 'vitest/config';

// GDD section 6: packages other than sim keep 70%+ line coverage.
export default defineConfig({
  test: {
    // demand.test runs Sim.init on generated rounds; the default 5 s flakes under a parallel
    // `pnpm test` on a loaded machine (the same fix as packages/sim before #27).
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 70 },
    },
  },
});
