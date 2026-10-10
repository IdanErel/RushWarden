import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: 'src',
    coverage: {
      provider: 'v8',
      include: ['src/portal/**/*.ts', 'src/game-config.ts'],
      exclude: ['src/portal/**/*.test-helper.ts'],
      thresholds: { lines: 70 },
    },
  },
});
