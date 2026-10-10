import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 200 full rounds in one test; the default 5 s flakes under a parallel `pnpm test` on a loaded
    // machine (the same fix as packages/sim before #27).
    testTimeout: 30_000,
  },
});
