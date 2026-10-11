import { defineConfig, devices } from '@playwright/test';

// Run screen flow on the dev page (real run controller, dev stand-in cards, fake traffic),
// phone and desktop.
const executablePath = process.env['PW_CHROMIUM_PATH'];
const launch = executablePath ? { launchOptions: { executablePath } } : {};
// UI_E2E_PORT moves the preview server off 5175 when another checkout is using it.
const port = Number(process.env['UI_E2E_PORT'] ?? '5175');
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL },
  webServer: {
    command: `pnpm run dev:build && pnpm exec vite preview --port ${port} --strictPort`,
    url: baseURL,
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
