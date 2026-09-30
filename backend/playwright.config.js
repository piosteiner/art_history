// End-to-end tests of the admin panel in a real (headless) browser: npm run test:e2e
// They run against their own database (arthistory_test, reset before every run) and their own server on port 3006,
// never against dev or production data. deploy.sh runs them before touching production. Details: test/e2e/README.md
const { defineConfig } = require('@playwright/test');
const { BASE } = require('./test/e2e/env');

module.exports = defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.spec.js',
  workers: 1,               // one shared database and server: specs run one after another
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 8000 },
  retries: 0,
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
