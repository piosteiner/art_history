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
  // the users' sessions, logged in once per run by global-setup.js (cookies only — never in the repo)
  sessionFile: (user) => path.join(STATE_DIR, `session-${user}.json`),
  PID_FILE: path.join(STATE_DIR, 'server.pid'),
  // Wikidata/Commons point at the fixture server (wikidata-fixtures.js), never at the real sites.
  serverEnv: () => ({ ...process.env, DB_NAME: 'arthistory_test', PORT: String(PORT), NODE_ENV: 'development',
    WIKIDATA_BASE: 'http://127.0.0.1:3007', COMMONS_BASE: 'http://127.0.0.1:3007',
    MET_BASE: 'http://127.0.0.1:3007', NOMINATIM_BASE: 'http://127.0.0.1:3007', AIC_BASE: 'http://127.0.0.1:3007', CLEVELAND_BASE: 'http://127.0.0.1:3007', LOBID_BASE: 'http://127.0.0.1:3007',
    SIKART_BASE: 'http://127.0.0.1:3007/sik' }),
};
