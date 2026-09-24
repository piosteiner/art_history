// Two pools, two Postgres roles: the public API can only read; the admin panel can write.
const { Pool, types } = require('pg');
const config = require('./config');

// Return bigint ids as JS numbers (safe: ids stay far below 2^53).
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

const apiPool = new Pool({ connectionString: config.db.apiUrl, max: 5, application_name: 'arthistory-api' });
const adminPool = new Pool({ connectionString: config.db.adminUrl, max: 3, application_name: 'arthistory-admin' });

for (const pool of [apiPool, adminPool]) {
  pool.on('error', (err) => console.error('idle pg client error', err.message));
}

module.exports = { apiPool, adminPool };
