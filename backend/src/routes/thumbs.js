// GET /v1/thumb?src=<image url>&w=250 — a small WebP of an image from a museum's own server. Wikimedia makes its own
// thumbnails (the site asks it directly); other image servers don't: the site's lists loaded a 250 KB "large" JPEG for
// a 70-pixel card, and a server that refuses anonymous (CORS) loading — the Academy of Fine Arts Vienna's — left the
// card empty. Here the image is fetched once, resized with sharp, kept on disk and served with a year's caching; the
// visitor's browser never contacts the museum's server.
// Only images of our own entries (the table images): no open proxy, nothing fetched that an editor didn't add.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { apiPool } = require('../db');
const { badRequest, notFound } = require('../http');

const router = express.Router();
const DIR = process.env.THUMB_DIR || path.join(__dirname, '..', '..', 'var', 'thumbs');
const WIDTHS = [120, 250, 330, 500, 800];      // the sizes the site asks for (frontend/src/html.ts thumb)
const MAX_BYTES = 40 * 1024 * 1024;           // an original larger than this isn't fetched
const TIMEOUT = 20000;
const pending = new Map();                     // key → promise: one fetch per image, however many ask at once

fs.mkdirSync(DIR, { recursive: true });

// the end-to-end tests' museum (env THUMB_TEST_SERVER = "https://museum.test/ http://127.0.0.1:3007/museum/"), as the
// other outside services point at the fixture server there
const [TEST_FROM, TEST_TO] = (process.env.THUMB_TEST_SERVER || '').split(' ');
const fetchUrl = (src) => (TEST_FROM && src.startsWith(TEST_FROM) ? TEST_TO + src.slice(TEST_FROM.length) : src);

async function make(src, width, file) {
  const res = await fetch(fetchUrl(src), { signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow',
    headers: { 'User-Agent': 'arthistory.piogino.ch thumbnails (pioginosteiner@gmail.com)', Accept: 'image/*' } });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: 502 });
  if (!/^image\//.test(res.headers.get('content-type') || '')) throw Object.assign(new Error('not an image'), { status: 502 });
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw Object.assign(new Error('too large'), { status: 502 });
  const input = Buffer.from(await res.arrayBuffer());
  if (input.length > MAX_BYTES) throw Object.assign(new Error('too large'), { status: 502 });
  const out = await sharp(input, { failOn: 'none' }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, out);
  await fs.promises.rename(tmp, file);         // whole or not at all: a reader never sees half a file
  return out;
}

router.get('/', async (req, res) => {
  const src = typeof req.query.src === 'string' ? req.query.src : '';
  const w = Number(req.query.w);
  if (!/^https:\/\/[^\s]+$/.test(src) || src.length > 2000) throw badRequest('src: an image address (https://…)');
  if (!WIDTHS.includes(w)) throw badRequest(`w: one of ${WIDTHS.join(', ')}`);
  const { rows } = await apiPool.query('SELECT 1 FROM images WHERE url = $1 LIMIT 1', [src]);
  if (!rows.length) throw notFound('not an image of this site');
  const key = `${crypto.createHash('sha256').update(src).digest('hex').slice(0, 32)}-${w}`;
  const file = path.join(DIR, `${key}.webp`);
  let body;
  try {
    body = await fs.promises.readFile(file);
  } catch {
    if (!pending.has(key)) pending.set(key, make(src, w, file).finally(() => pending.delete(key)));
    try {
      body = await pending.get(key);
    } catch (err) {
      res.set('Cache-Control', 'public, max-age=300');   // a museum server down: asked again in five minutes
      return res.status(err.status || 502).json({ error: 'bad_gateway', message: `the image could not be fetched (${err.message})` });
    }
  }
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.send(body);
});

module.exports = { router, WIDTHS };
