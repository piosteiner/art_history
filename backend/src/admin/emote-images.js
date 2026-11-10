// Emote pictures served by our own server (owner 2026-11-10, as on the adenai map and movies.piogino.ch): the chats
// show /site/emotes/img/<id>.webp (<id>-4x.webp for the bigger hover view) on the admin host instead of 7TV's
// cdn.7tv.app, so visitors' browsers never contact 7TV. A picture is fetched from 7TV the first time it is asked for
// and kept in backend/var/emote-cache/. Only ids of the current chat emotes are served.
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const emotes = require('./emotes');

const CACHE = path.join(__dirname, '..', '..', 'var', 'emote-cache');
const TIMEOUT = 15000;

/** an emote's 7TV id from its stored address (7TV's own, or ours), or null */
const idOf = (url) => ((/\/\/cdn\.7tv\.app\/emote\/([0-9A-Za-z]+)\//.exec(url || '') || /\/emotes\/img\/([0-9A-Za-z]+)\.webp$/.exec(url || '') || [])[1] || null);

/** the address the site shows for a stored emote: ours for 7TV pictures, anything else (own images) as it is */
function publicUrl(url) {
  const id = /\/\/cdn\.7tv\.app\/emote\//.test(url || '') ? idOf(url) : null;
  return id ? `https://${config.adminHost}/site/emotes/img/${id}.webp` : url;
}

let known = { at: 0, ids: new Set() };
async function isKnown(pool, id) {
  if (known.at < Date.now() - 60000) {
    const { emotes: list } = await emotes.load(pool);
    known = { at: Date.now(), ids: new Set(Object.values(list).map((e) => idOf(e.url)).filter(Boolean)) };
  }
  return known.ids.has(id);
}

const pending = new Map();
/** the cached file for an emote picture (size '2x' or '4x'), fetched from 7TV the first time; null for unknown ids */
async function imageFile(pool, id, size = '2x') {
  if (!/^[0-9A-Za-z]{1,40}$/.test(id) || !['2x', '4x'].includes(size) || !(await isKnown(pool, id))) return null;
  const file = path.join(CACHE, `${id}-${size}.webp`);
  try { await fs.access(file); return file; } catch { /* not there yet */ }
  const key = `${id}-${size}`;
  if (!pending.has(key)) {
    pending.set(key, (async () => {
      const res = await fetch(`https://cdn.7tv.app/emote/${id}/${size}.webp`, { signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw new Error(`7TV image answered ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 4).toString('latin1') !== 'RIFF' || buf.subarray(8, 12).toString('latin1') !== 'WEBP') throw new Error('7TV sent no WebP');
      await fs.mkdir(CACHE, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, file);
    })().finally(() => pending.delete(key)));
  }
  await pending.get(key);
  return file;
}

module.exports = { idOf, publicUrl, imageFile };
