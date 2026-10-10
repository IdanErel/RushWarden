import { defineConfig } from '@playwright/test';

// The clip tool's own check (e2e/clip.spec.ts). The spec launches its browsers through
// cli/render.ts (PW_CHROMIUM_PATH for a local Chromium), so no browser project is configured.
export default defineConfig({
  testDir: 'e2e',
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 300_000,
  workers: 1,
});
