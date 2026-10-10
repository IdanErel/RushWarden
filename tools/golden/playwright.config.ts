import { defineConfig, devices } from '@playwright/test';

// GDD section 3/11: golden hashes on Chromium, WebKit and Firefox every PR.
// Mobile WebViews run nightly (ADR-003). Set GOLDEN_ENGINES=chromium to run one engine locally.
const executablePath = process.env['PW_CHROMIUM_PATH'];
const only = process.env['GOLDEN_ENGINES']?.split(',');
const all = [
  {
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      ...(executablePath ? { launchOptions: { executablePath } } : {}),
    },
  },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
];

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env['CI'] ? 'github' : 'list',
  projects: only ? all.filter((p) => only.includes(p.name)) : all,
});
