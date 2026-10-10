import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173' },
  webServer: [
    // The public build (dist/, made by `pnpm build` or `pnpm size`): what players get.
    {
      command: 'pnpm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env['CI'],
    },
    // The hooks build (VITE_TEST_HOOKS=1, test hooks H1 and H4) for specs that need them.
    {
      command: 'pnpm run build:e2e && pnpm run preview:e2e',
      url: 'http://localhost:4174',
      reuseExistingServer: !process.env['CI'],
    },
  ],
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 5'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
});
