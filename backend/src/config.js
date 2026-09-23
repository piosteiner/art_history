// Non-secret defaults live here; secrets are loaded from outside the repo.
const os = require('os');
const path = require('path');

require('dotenv').config({
  path: process.env.ENV_FILE || path.join(os.homedir(), '.config/arthistory/backend.env'),
  quiet: true,
});

module.exports = {
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3004,
  corsOrigin: process.env.CORS_ORIGIN || 'https://arthistory.piogino.ch',
  apiHost: process.env.API_HOST || 'api.arthistory.piogino.ch',
  adminHost: process.env.ADMIN_HOST || 'admin.arthistory.piogino.ch',
};
