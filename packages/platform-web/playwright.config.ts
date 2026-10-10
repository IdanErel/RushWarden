import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'];
// WEB_E2E_PORT moves both preview servers (public on it, hooks build on it + 1) off 4173/4174
// when another checkout is using them. e2e/ports.ts reads the same variable.
const port = Number(process.env['WEB_E2E_PORT'] ?? '4173');
const hooksPort = port + 1;

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}` },
  webServer: [
    // The public build (dist/, made by `pnpm build` or `pnpm size`): what players get.
    {
      command: `pnpm exec vite preview --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env['CI'],
    },
    // The hooks build (VITE_TEST_HOOKS=1, test hooks H1 and H4) for specs that need them.
    {
      command: `pnpm run build:e2e && pnpm exec vite preview --outDir node_modules/.e2e-dist --port ${hooksPort} --strictPort`,
      url: `http://localhost:${hooksPort}`,
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
