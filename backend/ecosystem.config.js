// pm2 process definition. No secrets here — they come from ~/.config/arthistory/backend.env.
module.exports = {
  apps: [{
    name: 'arthistory-api',
    script: 'src/server.js',
    cwd: '/var/www/arthistory-api/backend',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: 3004,
    },
    time: true,
  }],
};
