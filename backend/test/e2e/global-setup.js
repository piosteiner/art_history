// Before all specs: migrate + reset the test database, load content/, create two users with passwords generated for
// this run (kept in the OS temp dir, never in the repo), build the admin bundles, start the test server.
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { BACKEND, DB, STATE_DIR, AUTH_FILE, serverEnv } = require('./env');
const server = require('./server');

module.exports = async () => {
  const run = (cmd, args, input) => execFileSync(cmd, args, { cwd: BACKEND, env: serverEnv(), input, stdio: ['pipe', 'pipe', 'pipe'] });
  run('node', ['scripts/migrate.js']);
  run('psql', ['-X', '-q', '-h', 'localhost', '-U', 'arthistory_owner', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-f', 'test/e2e/reset.sql']);
  run('node', ['scripts/import.js']);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const auth = {};
  for (const user of ['tester', 'tester2']) {
    auth[user] = crypto.randomBytes(18).toString('base64url');
    run('node', ['scripts/admin-user.js', user], auth[user]);
  }
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth), { mode: 0o600 });
  run('npm', ['run', '--silent', 'build:admin:dev']);
  await server.stop();  // a leftover from an aborted run
  await server.start();
};
