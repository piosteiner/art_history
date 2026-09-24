// Non-secret defaults live here; secrets are loaded from outside the repo.
const os = require('os');
const path = require('path');

require('dotenv').config({
  path: process.env.ENV_FILE || path.join(os.homedir(), '.config/arthistory/backend.env'),
  quiet: true,
});

const dbUrl = (role, pw) => {
  const url = new URL('postgres://localhost');
  url.hostname = process.env.DB_HOST || 'localhost';
  url.port = process.env.DB_PORT || '5432';
  url.pathname = '/' + (process.env.DB_NAME || 'arthistory');
  url.username = `arthistory_${role}`;
  url.password = pw || '';
  return url.toString();
};

module.exports = {
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3004,
  corsOrigin: process.env.CORS_ORIGIN || 'https://arthistory.piogino.ch',
  apiHost: process.env.API_HOST || 'api.arthistory.piogino.ch',
  adminHost: process.env.ADMIN_HOST || 'admin.arthistory.piogino.ch',
  db: {
    name: process.env.DB_NAME || 'arthistory',
    ownerUrl: dbUrl('owner', process.env.DB_OWNER_PASSWORD),
    adminUrl: dbUrl('admin', process.env.DB_ADMIN_PASSWORD),
    apiUrl: dbUrl('api', process.env.DB_API_PASSWORD),
  },
};
