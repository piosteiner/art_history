const app = require('./app');
const config = require('./config');
const { apiPool, adminPool } = require('./db');
const live = require('./admin/live');

const server = app.listen(config.port, config.host, () => {
  console.log(`arthistory-api listening on http://${config.host}:${config.port} (${config.env}, db ${config.db.name})`);
});
live.attach(server);  // admin panel's WebSocket (/live on the admin host)

// pm2 reload/stop sends SIGINT: finish in-flight requests, then close DB pools.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // Working copies are persisted first; open WebSockets would otherwise keep server.close() waiting.
    live.close().finally(() => server.close(async () => {
      await Promise.allSettled([apiPool.end(), adminPool.end()]);
      process.exit(0);
    }));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
