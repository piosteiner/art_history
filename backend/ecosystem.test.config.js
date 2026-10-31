// pm2 process of the test environment (scripts/test-env.sh): the same code as production, its own database cluster
// (18/test, :5433) and hosts. No secrets here — they come from ~/.config/arthistory/test.env (not backend.env: the
// test environment has no API keys of outside services).
const os = require('os');

module.exports = {
  apps: [{
    name: 'arthistory-test',
    script: 'src/server.js',
    cwd: '/var/www/arthistory/backend',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '250M',
    env: {
      NODE_ENV: 'production',
      ENV_FILE: `${os.homedir()}/.config/arthistory/test.env`,
      HOST: '127.0.0.1',
      PORT: 3010,
      DB_NAME: 'arthistory',
      DB_PORT: 5433,
      TEST_ENV: '1',
      TEST_SITE: 'https://test.arthistory.piogino.ch',
      API_HOST: 'api.test.arthistory.piogino.ch',
      ADMIN_HOST: 'admin.test.arthistory.piogino.ch',
      CORS_ORIGIN: 'https://test.arthistory.piogino.ch',
    },
    time: true,
  }],
};
