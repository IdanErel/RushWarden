import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/standin-cards.ts', 'src/cli.ts', 'src/worker.ts'],
      thresholds: { lines: 70 },
    },
  },
});
