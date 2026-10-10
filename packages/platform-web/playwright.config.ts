import { existsSync } from 'node:fs';
import { defineConfig, devices, webkit } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'];
const launch = executablePath ? { launchOptions: { executablePath } } : {};

// The WebKit phone needs the WebKit browser. CI's web job installs only Chromium until
// `.github/workflows/ci.yml` adds `webkit` to its `playwright install` line (Lead-owned). Until
// then the project is left out where WebKit is missing, and the run says so. PW_WEBKIT=1 forces it
// in, so a missing browser fails instead of being skipped.
const withWebkit = process.env['PW_WEBKIT'] === '1' || existsSync(webkit.executablePath());
if (!withWebkit) console.warn('[e2e] WebKit is not installed: the phone-webkit project is skipped');

// Phase 1 test plan §2.4 / §3.1 (approved by the Lead): the phone project is exactly the GDD §2
// design size, 390×844, and a WebKit phone (iPhone 12, also 390×844) runs the toy specs.
// Both phones render at device pixel ratio 1. Headless browsers draw WebGL in software: at the
// Pixel 5's 2.75 the run screen measured 2 fps and a 15 s round took 31 s of wall time, against
// 17 fps and 16.8 s at 1 (desktop: 18 fps, 16.5 s). Layout depends on CSS pixels, not on the
// ratio; sharpness on real screens is checked on Idan's devices (test plan §3.2).
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 };
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
      use: { ...devices['Pixel 5'], ...phone, ...launch },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...launch } },
    ...(withWebkit
      ? [
          {
            name: 'phone-webkit',
            testMatch: 'toy/**/*.spec.ts',
            use: { ...devices['iPhone 12'], ...phone },
          },
        ]
      : []),
  ],
});
