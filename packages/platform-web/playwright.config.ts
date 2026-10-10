import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'pnpm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
  },
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
