import { defineConfig, devices } from '@playwright/test';

// Dev-page check for the renderer: boots the scene, sees vehicles arrive from the worker, and
// saves a phone-size screenshot for PR evidence (test-results/). Not part of `pnpm test`.
const executablePath = process.env['PW_CHROMIUM_PATH'];
// RENDER_E2E_PORT lets several worktrees run this suite at once (default 5174).
const port = Number(process.env['RENDER_E2E_PORT'] ?? 5174);

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `pnpm run dev:build && pnpm exec vite preview --port ${port}`,
    url: `http://localhost:${port}`,
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
