// Versioned URLs for the admin's static files: /static/editor.js?v=<first 10 hex of its SHA-256>. A deploy that
// changes a file changes its URL, so browsers fetch the new version at once instead of using a cached copy for the
// rest of its max-age (1 h). Same lookup order as the static routes in index.js: static-dev/ first outside production.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const DIRS = [...(config.env !== 'production' ? ['static-dev'] : []), 'static'].map((d) => path.join(__dirname, d));
const cache = new Map();  // name → { mtimeMs, url }

function asset(name) {
  for (const dir of DIRS) {
    let stat;
    try { stat = fs.statSync(path.join(dir, name)); } catch { continue; }
    const hit = cache.get(name);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.dir === dir) return hit.url;  // rehashed only when the file changes
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex').slice(0, 10);
    const url = `/static/${name}?v=${hash}`;
    cache.set(name, { mtimeMs: stat.mtimeMs, dir, url });
    return url;
  }
  return `/static/${name}`;
}

module.exports = { asset };
