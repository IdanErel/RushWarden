import { defineConfig, devices } from '@playwright/test';

// Run screen flow on the dev page (stub run controller + fake traffic), phone and desktop.
const executablePath = process.env['PW_CHROMIUM_PATH'];
const launch = executablePath ? { launchOptions: { executablePath } } : {};

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5175' },
  webServer: {
    command: 'pnpm run dev:build && pnpm exec vite preview',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env['CI'],
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, ...launch },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...launch } },
  ],
});
