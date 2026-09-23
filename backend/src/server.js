const app = require('./app');
const config = require('./config');

app.listen(config.port, config.host, () => {
  console.log(`arthistory-api listening on http://${config.host}:${config.port} (${config.env})`);
});
