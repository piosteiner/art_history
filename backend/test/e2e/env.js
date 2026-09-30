// Shared settings of the end-to-end tests.
const path = require('path');
const os = require('os');

const PORT = 3006;
const BACKEND = path.join(__dirname, '..', '..');
const STATE_DIR = path.join(os.tmpdir(), 'arthistory-e2e');  // pid file and generated passwords (never in the repo)

module.exports = {
  PORT,
  BASE: `http://admin.localhost:${PORT}`,
  DB: 'arthistory_test',
  BACKEND,
  STATE_DIR,
  AUTH_FILE: path.join(STATE_DIR, 'auth.json'),
  PID_FILE: path.join(STATE_DIR, 'server.pid'),
  serverEnv: () => ({ ...process.env, DB_NAME: 'arthistory_test', PORT: String(PORT), NODE_ENV: 'development' }),
};
