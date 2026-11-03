// pm2 process definition. No secrets here — they come from ~/.config/arthistory/backend.env.
module.exports = {
  apps: [{
    name: 'arthistory-api',
    script: 'src/server.js',
    cwd: '/var/www/arthistory/backend',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    // it idles at ~280 MB (caches per data version); 300 M restarted it twice on 2026-11-03 — a 502 each time
    max_memory_restart: '450M',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: 3004,
      DB_NAME: 'arthistory',
    },
    time: true,
  }],
};
