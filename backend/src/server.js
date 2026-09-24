const app = require('./app');
const config = require('./config');
const { apiPool, adminPool } = require('./db');

const server = app.listen(config.port, config.host, () => {
  console.log(`arthistory-api listening on http://${config.host}:${config.port} (${config.env}, db ${config.db.name})`);
});

// pm2 reload/stop sends SIGINT: finish in-flight requests, then close DB pools.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await Promise.allSettled([apiPool.end(), adminPool.end()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
