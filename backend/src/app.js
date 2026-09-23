const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const v1 = require('./routes/v1');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // nginx on the same host

app.use(helmet({
  // Allow the frontend (different origin) to read API responses.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// One process, two hostnames: /v1 only on the API host, /admin only on the admin host.
const onHost = (host) => (req, res, next) =>
  (req.hostname === host || config.env !== 'production') ? next() : res.status(404).json({ error: 'not_found' });

app.use('/v1', onHost(config.apiHost), cors({ origin: config.corsOrigin }), v1);

app.use('/admin', onHost(config.adminHost), (req, res) => {
  res.status(503).type('text').send('Admin panel not built yet.');
});

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

module.exports = app;
