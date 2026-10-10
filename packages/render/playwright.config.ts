import { defineConfig, devices } from '@playwright/test';

// Dev-page check for the renderer: boots the scene, sees vehicles arrive from the worker, and
// saves a phone-size screenshot for PR evidence (test-results/). Not part of `pnpm test`.
const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5174' },
  webServer: {
    command: 'pnpm run dev:build && pnpm exec vite preview',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env['CI'],
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
});
