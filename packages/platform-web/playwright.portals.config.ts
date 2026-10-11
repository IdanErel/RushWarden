import { defineConfig, devices } from '@playwright/test';

// P1-PLT-02: plays the packaged Poki and CrazyGames zips (`pnpm package:poki` and
// `pnpm package:crazygames` first) against stub SDKs. The spec serves the zips itself.
const executablePath = process.env['PW_CHROMIUM_PATH'];
export default defineConfig({
  testDir: 'e2e-portals',
  reporter: process.env['CI'] ? 'github' : 'list',
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
});
