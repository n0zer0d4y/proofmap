import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against generated single-file pages under file://.
// `npm run e2e` builds the viewer and injects the fixture data first.
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  reporter: [['list']],
  use: { trace: 'retain-on-failure', viewport: { width: 1400, height: 900 } },
  // Screenshot baselines are per platform; a missing one is written on the first run.
  updateSnapshots: 'missing',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.ALL_BROWSERS
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
});
