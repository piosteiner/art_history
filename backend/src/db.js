// Two pools, two Postgres roles: the public API can only read; the admin panel can write.
const { Pool, types } = require('pg');
const config = require('./config');

// Return bigint ids as JS numbers (safe: ids stay far below 2^53).
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

// Pool sizes: the roles have connection limits (db/setup-roles.sql) shared by production, dev and the test servers —
// the end-to-end tests run smaller pools (test/e2e/env.js), so a deploy's tests never crowd out the live site.
const apiPool = new Pool({ connectionString: config.db.apiUrl, max: Number(process.env.DB_API_POOL_MAX) || 5, application_name: 'arthistory-api' });
const adminPool = new Pool({ connectionString: config.db.adminUrl, max: Number(process.env.DB_ADMIN_POOL_MAX) || 3, application_name: 'arthistory-admin' });

for (const pool of [apiPool, adminPool]) {
  pool.on('error', (err) => console.error('idle pg client error', err.message));
}

module.exports = { apiPool, adminPool };
