// UI tests for the HTML report: `npm run test:ui` (update screenshots with `npm run test:ui -- --update-snapshots`).
// Global setup builds the demo repos and their reports; specs open them straight from disk (file://).
import { defineConfig, devices } from '@playwright/test';

// Use a Chromium already on disk (e.g. where the Playwright CDN is unreachable): TECTON_CHROMIUM=/path/to/chrome
const executablePath = process.env.TECTON_CHROMIUM || undefined;
/** @type {import('@playwright/test').PlaywrightTestOptions['reducedMotion']} */
const reducedMotion = 'reduce';
const base = { reducedMotion, launchOptions: { executablePath } };

export default defineConfig({
  testDir: 'test/ui',
  globalSetup: './test/ui/setup.js',
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // screenshots differ slightly between operating systems (font rendering), so baselines are per platform
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' } },
  projects: [
    { name: 'desktop-light', use: { ...base, viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...base, viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
    { name: 'phone-light', use: { ...base, ...devices['iPhone 13'], defaultBrowserType: 'chromium', colorScheme: 'light' } },
    { name: 'phone-dark', use: { ...base, ...devices['iPhone 13'], defaultBrowserType: 'chromium', colorScheme: 'dark' } },
  ],
});
