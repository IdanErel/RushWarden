import { defineConfig, devices } from '@playwright/test';

// P1-PLT-01: smoke test of the packaged itch zip (`pnpm package:itch` first). The spec serves the
// zip itself, so there is no web server here and no other spec runs.
const executablePath = process.env['PW_CHROMIUM_PATH'];
export default defineConfig({
  testDir: 'e2e-itch',
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
