// Shared settings of the end-to-end tests.
// Several workers run the spec files side by side (playwright.config.js); each worker has its own database and its
// own test server — a shard — so the specs never see each other's changes:
//   shard 0: arthistory_test, :3006 · shard 1: arthistory_test_1, :3008 · shard 2: arthistory_test_2, :3009
// (the extra databases created once with `db/setup.sh arthistory_test_N`). A worker's shard is its
// TEST_PARALLEL_INDEX (0 … workers − 1, set by Playwright); global-setup.js prepares all of them. Two workers by
// default (E2E_WORKERS, at most 3): the machine has 2 CPUs — a third made each test slower, not the run shorter.
const path = require('path');
const os = require('os');

const BACKEND = path.join(__dirname, '..', '..');
const STATE_DIR = path.join(os.tmpdir(), 'arthistory-e2e');  // pid files and generated passwords (never in the repo)
const FIXTURES = 'http://127.0.0.1:3007';                     // wikidata-fixtures.js, shared by all shards
const WORKERS = Math.max(1, Math.min(3, Number(process.env.E2E_WORKERS) || 2));

function shard(i) {
  const PORT = i === 0 ? 3006 : 3007 + i;
  const DB = i === 0 ? 'arthistory_test' : `arthistory_test_${i}`;
  return {
    i, PORT, DB,
    BASE: `http://admin.localhost:${PORT}`,
    API: `http://127.0.0.1:${PORT}/v1`,
    PID_FILE: path.join(STATE_DIR, `server-${i}.pid`),
    LOG_FILE: path.join(STATE_DIR, `server-${i}.log`),
    // the users' sessions, logged in once per run by global-setup.js (cookies only — never in the repo)
    sessionFile: (user) => path.join(STATE_DIR, `session-${i}-${user}.json`),
    // Wikidata, Commons, museums, Nominatim, lobid, SIKART, Metagrid, LC, BnF, RKD point at the fixture server, never at the real sites.
    // small pools: these servers share the roles' connection limits with the live site (src/db.js)
    serverEnv: () => ({ ...process.env, DB_NAME: DB, PORT: String(PORT), NODE_ENV: 'development', DB_ADMIN_POOL_MAX: '2', DB_API_POOL_MAX: '2',
      WIKIDATA_BASE: FIXTURES, COMMONS_BASE: FIXTURES, MET_BASE: FIXTURES, NOMINATIM_BASE: FIXTURES, AIC_BASE: FIXTURES,
      CLEVELAND_BASE: FIXTURES, LOBID_BASE: FIXTURES, SIKART_BASE: `${FIXTURES}/sik`,
      METAGRID_BASE: `${FIXTURES}/metagrid`, LC_BASE: `${FIXTURES}/lc`, BNF_BASE: `${FIXTURES}/bnf`, RKD_BASE: `${FIXTURES}/rkd`,
      OPENLIBRARY_BASE: `${FIXTURES}/openlibrary`, CROSSREF_BASE: `${FIXTURES}/crossref`,
      RIJKS_BASE: `${FIXTURES}/rijks`, RIJKS_ID_BASE: `${FIXTURES}/rijksid`, EUROPEANA_BASE: `${FIXTURES}/europeana`,
      SMITHSONIAN_BASE: `${FIXTURES}/si`, JAPANSEARCH_BASE: `${FIXTURES}/jps`, KULTURNAV_BASE: `${FIXTURES}/kulturnav`,
      NLK_BASE: `${FIXTURES}/nlk`, ARCO_BASE: `${FIXTURES}/arco`, SMK_BASE: `${FIXTURES}/smk`, DIMU_BASE: `${FIXTURES}/dimu`,
      DIMU_KEY: 'test', EUROPEANA_KEY: 'test', SMITHSONIAN_KEY: 'test' }),
  };
}

const current = shard(Number(process.env.TEST_PARALLEL_INDEX) || 0);

module.exports = {
  ...current,       // this worker's shard: PORT, DB, BASE, API, sessionFile, serverEnv …
  shard,
  shards: () => Array.from({ length: WORKERS }, (_, i) => shard(i)),
  WORKERS,
  BACKEND,
  STATE_DIR,
  AUTH_FILE: path.join(STATE_DIR, 'auth.json'),
};
