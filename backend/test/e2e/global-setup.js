// Before all specs: migrate + reset the test database, load the fixed sample content (test/e2e/fixtures/content — not
// the live snapshot in content/, which changes whenever the real content is exported), create two users with passwords generated for
// this run (kept in the OS temp dir, never in the repo), build the admin bundles, start the test server.
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { request } = require('@playwright/test');
const { BACKEND, BASE, DB, STATE_DIR, AUTH_FILE, serverEnv, sessionFile } = require('./env');
const server = require('./server');
const wikidataFixtures = require('./wikidata-fixtures');

module.exports = async () => {
  const run = (cmd, args, input) => execFileSync(cmd, args, { cwd: BACKEND, env: serverEnv(), input, stdio: ['pipe', 'pipe', 'pipe'] });
  run('node', ['scripts/migrate.js']);
  run('psql', ['-X', '-q', '-h', 'localhost', '-U', 'arthistory_owner', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-f', 'test/e2e/reset.sql']);
  // country/region outlines (migration 032): a few rectangles instead of the 40 MB Natural Earth files
  run('node', ['scripts/boundaries.js', '--file', 'test/e2e/fixtures/boundaries.geojson']);
  execFileSync('node', ['scripts/import.js'], { cwd: BACKEND, env: { ...serverEnv(), CONTENT_DIR: `${BACKEND}/test/e2e/fixtures/content` }, stdio: ['pipe', 'pipe', 'pipe'] });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const auth = {};
  for (const user of ['tester', 'tester2']) {
    auth[user] = crypto.randomBytes(18).toString('base64url');
    run('node', ['scripts/admin-user.js', user], auth[user]);
  }
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth), { mode: 0o600 });
  run('npm', ['run', '--silent', 'build:admin:dev']);
  await wikidataFixtures.start();
  await server.stop();  // a leftover from an aborted run
  await server.start();
  // Log both users in once: every test starts a fresh browser context with this session (helpers.js) instead of going
  // through the login form — which hashes the password with scrypt on purpose and took ~0.9 s per test.
  for (const user of ['tester', 'tester2']) {
    const http = await request.newContext({ baseURL: BASE });
    const res = await http.post('/login', { form: { username: user, password: auth[user] }, headers: { Origin: BASE }, maxRedirects: 0 });
    if (res.status() !== 303 && res.status() !== 302) throw new Error(`login of ${user} for the test sessions failed: ${res.status()}`);
    await http.storageState({ path: sessionFile(user) });
    await http.dispose();
  }
};
