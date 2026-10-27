// End-to-end tests of the admin panel in a real (headless) browser: npm run test:e2e
// They run against their own databases (arthistory_test, _1, _2, reset before every run) and their own servers (:3006, :3008, :3009),
// never against dev or production data. deploy.sh runs them before touching production. Details: test/e2e/README.md
const { defineConfig } = require('@playwright/test');
const { BASE, WORKERS } = require('./test/e2e/env');

module.exports = defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.spec.js',
  // spec files side by side, each worker on its own database and server (test/e2e/env.js: shards; E2E_WORKERS=1 for
  // one after another); the tests of one file still run in order
  workers: WORKERS,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 8000 },
  retries: Number(process.env.E2E_RETRIES) || 0,  // deploy.sh: 1 — a test passing on its retry is reported as flaky
  reporter: [['list']],
  outputDir: 'test/e2e/.results',
  globalSetup: require.resolve('./test/e2e/global-setup'),
  globalTeardown: require.resolve('./test/e2e/global-teardown'),
  use: {
    baseURL: BASE,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 900 },
    // admin.localhost → this machine (the app routes the admin panel by host name)
    launchOptions: { args: ['--host-resolver-rules=MAP admin.localhost 127.0.0.1'] },
    trace: 'retain-on-failure',
  },
});
