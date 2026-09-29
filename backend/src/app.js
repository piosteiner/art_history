const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const v1 = require('./routes/v1');
const admin = require('./admin');
const { HttpError } = require('./http');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // nginx on the same host

app.use(helmet({
  // Allow the frontend (different origin) to read API responses.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // helmet's default is no-referrer, which makes browsers send "Origin: null" on same-site form posts —
  // and the admin's checkOrigin needs the real Origin. same-origin still sends nothing to other sites.
  referrerPolicy: { policy: 'same-origin' },
}));

// One process, two hostnames: /v1 on the API host (any host in dev), the admin panel at the root of the admin host
// (admin.localhost in dev — browsers resolve *.localhost to 127.0.0.1).
const onHost = (host) => (req, res, next) =>
  (req.hostname === host || config.env !== 'production') ? next() : res.status(404).json({ error: 'not_found' });

app.use('/v1', onHost(config.apiHost), cors({ origin: config.corsOrigin }), v1);

app.use((req, res, next) => {
  if (req.hostname !== config.adminHost) return next();
  // The panel used to live under /admin/… — keep old bookmarks working.
  if ((req.method === 'GET' || req.method === 'HEAD') && /^\/admin(\/|$)/.test(req.path)) {
    return res.redirect(301, req.originalUrl.slice('/admin'.length) || '/');
  }
  admin(req, res, next);
});

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.error, message: err.message });
  // Postgres statement_timeout (5 s for the api role) → tell the client to retry rather than "internal error".
  if (err.code === '57014') return res.status(503).json({ error: 'timeout' });
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

module.exports = app;
