// Before all specs, for every shard (env.js) side by side: migrate + reset its database, load the fixed sample content
// (test/e2e/fixtures/content — not the live snapshot in content/, which changes whenever the real content is exported),
// create two users with passwords generated for this run (kept in the OS temp dir, never in the repo), start its
// test server, log the users in. Once: build the admin bundles, start the fixture server.
const fs = require('fs');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const { request } = require('@playwright/test');
const { BACKEND, STATE_DIR, AUTH_FILE, shards } = require('./env');
const server = require('./server');
const wikidataFixtures = require('./wikidata-fixtures');

const exec = promisify(execFile);

async function prepare(s, auth, built) {
  const run = (cmd, args, extra = {}) => exec(cmd, args, { cwd: BACKEND, env: { ...s.serverEnv(), ...extra } });
  await run('node', ['scripts/migrate.js']);
  await run('psql', ['-X', '-q', '-h', 'localhost', '-U', 'arthistory_owner', '-d', s.DB, '-v', 'ON_ERROR_STOP=1', '-f', 'test/e2e/reset.sql']);
  // country/region outlines (migration 032): a few rectangles instead of the 40 MB Natural Earth files
  await run('node', ['scripts/boundaries.js', '--file', 'test/e2e/fixtures/boundaries.geojson']);
  await run('node', ['scripts/import.js'], { CONTENT_DIR: `${BACKEND}/test/e2e/fixtures/content` });
  for (const user of Object.keys(auth)) {
    // the password on stdin (never in the process list)
    execFileSync('node', ['scripts/admin-user.js', user], { cwd: BACKEND, env: s.serverEnv(), input: auth[user], stdio: ['pipe', 'pipe', 'pipe'] });
  }
  await built;           // the server serves the admin bundles from static-dev/
  await server.stop(s);  // a leftover from an aborted run
  await server.start(s);
  // Log both users in once: every test starts a fresh browser context with this session (helpers.js) instead of going
  // through the login form — which hashes the password with scrypt on purpose and took ~0.9 s per test.
  for (const user of Object.keys(auth)) {
    const http = await request.newContext({ baseURL: s.BASE });
    const res = await http.post('/login', { form: { username: user, password: auth[user] }, headers: { Origin: s.BASE }, maxRedirects: 0 });
    if (res.status() !== 303 && res.status() !== 302) throw new Error(`login of ${user} on shard ${s.i} failed: ${res.status()}`);
    await http.storageState({ path: s.sessionFile(user) });
    await http.dispose();
  }
}

module.exports = async () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const auth = Object.fromEntries(['tester', 'tester2'].map((u) => [u, crypto.randomBytes(18).toString('base64url')]));
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth), { mode: 0o600 });
  // the bundles are built while the databases are prepared
  const built = exec('npm', ['run', '--silent', 'build:admin:test'], { cwd: BACKEND });
  await wikidataFixtures.start();
  await Promise.all([built, ...shards().map((s) => prepare(s, auth, built))]);
};
