// Fetching a picture from another website for a private reference image (routes/private-images.js, owner
// 2026-11-02: "add these images as a reference image … links of photos from other websites"). The address comes from a
// logged-in editor, yet the server must not be pointed at itself or the private network: only http(s), and every
// connection — the first and each redirect — checked at the moment it connects (the address the name resolves to, so
// a name can't resolve to an allowed address first and a private one after). At most 15 MB, 20 s, 4 redirects.
// A page (HTML) gives the pictures on it to choose from; of the same picture in several sizes (…-M.jpg, …-L.jpg) the
// largest. The end-to-end tests' museum: THUMB_TEST_SERVER maps https://museum.test/ to the fixture server.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const { UA } = require('./http');   // the panel's own User-Agent for outside requests

const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT = 20000;
const [TEST_FROM, TEST_TO] = (process.env.THUMB_TEST_SERVER || '').split(' ');

/** Loopback, private, link-local, carrier-grade NAT, multicast, unspecified — and IPv6's equivalents. */
function blocked(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const x = address.toLowerCase();
  if (x.startsWith('::ffff:')) return blocked(x.slice(7));
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
}
// dns.lookup with the check: Node connects to the addresses returned here, so the check and the connection agree
// (asked for all addresses — Node 22 tries them in turn — every one must be public)
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return callback(err);
    if (!list.length || list.some((x) => blocked(x.address))) {
      return callback(Object.assign(new Error(`${hostname} is not a public address`), { code: 'EBLOCKED' }));
    }
    return options.all ? callback(null, list) : callback(null, list[0].address, list[0].family);
  });
}

class FetchError extends Error {}

function get(url, { test, referer }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': UA, Accept: 'image/*, text/html;q=0.9, */*;q=0.5', ...(referer ? { Referer: referer } : {}) }, timeout: TIMEOUT,
      ...(test ? {} : { lookup: safeLookup }) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url) });
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new FetchError(`the site answered ${res.statusCode}`)); }
      if (Number(res.headers['content-length'] || 0) > MAX_BYTES) { res.destroy(); return reject(new FetchError('larger than 15 MB')); }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { res.destroy(); reject(new FetchError('larger than 15 MB')); } else chunks.push(c);
      });
      res.on('end', () => resolve({ type: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new FetchError('no answer within 20 s')));
    req.on('error', (err) => reject(err.code === 'EBLOCKED' ? new FetchError('not a public web address') : err instanceof FetchError ? err : new FetchError(`could not reach it (${err.code || err.message})`)));
  });
}

/** url (string) → { url (the final address), type, body }; only http(s), public addresses, 4 redirects at most.
 *  `referer`: the page the picture is on — some sites send their pictures only to their own pages (the Shozokan
 *  answers a bare request for an image with a redirect). */
async function fetchPublic(address, { referer = null } = {}) {
  let url;
  try { url = new URL(String(address).trim()); } catch { throw new FetchError('not a web address'); }
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new FetchError('only http and https addresses');
    if (url.username || url.password) throw new FetchError('no addresses with a user name');
    // an address written as an IP is connected to without a lookup: checked here
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && blocked(host)) throw new FetchError('not a public web address');
    const shown = url.href;
    const test = TEST_FROM && shown.startsWith(TEST_FROM);
    const r = await get(test ? new URL(TEST_TO + shown.slice(TEST_FROM.length)) : url, { test, referer: referer || `${url.origin}/` });
    if (!r.redirect) return { url: shown, type: r.type, body: r.body };
    url = r.redirect;
  }
  throw new FetchError('too many redirects');
}

/** The pictures a page shows (og:image, <img>, links to image files), absolute, one per picture — its largest size. */
function picturesOn(html, base, more = []) {
  const found = [];
  const add = (u) => {
    try {
      const abs = new URL(u.replace(/&amp;/g, '&'), base);
      if (/^https?:$/.test(abs.protocol)) found.push(abs.href);
    } catch { /* not an address */ }
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) add(m[1]);
  for (const u of more) add(u);
  for (const m of html.matchAll(/(?:href|data-src|data-full|data-large|data-zoom-image|data-[a-z-]*-src)=["']([^"']+\.(?:jpe?g|png|webp|gif|tiff?)(?:\?[^"']*)?)["']/gi)) add(m[1]);
  const pictures = found.filter((u) => /\.(jpe?g|png|webp|gif|tiff?)(\?|$)/i.test(u) && !/(logo|icon|sprite|banner|button|arrow|copy\.png|loading|spacer|blank)\d*\b/i.test(u));
  // one per picture: …-S / -M / -L, _s / _m / _l, small / medium / large → the largest; a IIIF image
  // (…/<id>/full/<size>/0/default.jpg) once, in its widest size
  const RANK = { s: 1, small: 1, thumb: 0, t: 0, m: 2, medium: 2, l: 3, large: 3, xl: 4, original: 5, o: 5 };
  const IIIF = /^(.*)\/full\/(max|full|\d+,\d*|,\d+|pct:[\d.]+)\/\d+\/default\.\w+$/i;
  const key = (u) => (IIIF.test(u) ? IIIF.exec(u)[1] : u.replace(/([-_.](?:s|m|l|xl|t|o|small|medium|large|thumb|original))(\.\w+)(\?.*)?$/i, '$2')).toLowerCase();
  const rank = (u) => {
    const iiif = IIIF.exec(u);
    if (iiif) return /^\d+,/.test(iiif[2]) ? 10 + Number.parseInt(iiif[2], 10) / 1e5 : 10;
    return RANK[(/[-_.](s|m|l|xl|t|o|small|medium|large|thumb|original)\.\w+(\?.*)?$/i.exec(u) || [])[1]?.toLowerCase()] ?? 2;
  };
  const best = new Map();
  for (const u of pictures) {
    const k = key(u);
    if (!best.has(k) || rank(u) > rank(best.get(k))) best.set(k, u);
  }
  return [...best.values()].slice(0, 40);
}

// Pictures a page loads only on request: the Shozokan's gallery shows five and fetches the others with "+"
// (/collection/?at=moreArtpic&id=…&artpic_page_number=N&get_type=sub, five per page, JSON) → their addresses, all sizes
// (picturesOn keeps the largest). A page without such a gallery: none.
async function galleryPictures(html, base) {
  const m = /class="detailMore"[^>]*data-id="(\d+)"/.exec(html);
  if (!m || !html.includes('moreArtpic')) return [];
  const out = [];
  for (let n = 1; n <= 20; n++) {
    let list;
    try {
      const got = await fetchPublic(new URL(`/collection/?at=moreArtpic&id=${m[1]}&artpic_page_number=${n}&get_type=sub`, base).href, { referer: base });
      const data = JSON.parse(got.body.toString('utf8'));
      list = data && data.status === 'OK' && Array.isArray(data.result) ? data.result : [];
    } catch { break; }
    for (const r of list) {
      for (const p of [r.art_image_path, r.art_L_image_path]) if (typeof p === 'string') out.push(p);
      if (typeof r.art_image_path === 'string') out.push(r.art_image_path.replace(/-[SM](\.\w+)$/, '-L$1'));
    }
    if (list.length < 5) break;
  }
  return out;
}

// Pictures a viewer loads only when you click on (owner 2026-11-03: the Philadelphia Museum of Art shows the first of
// three, the others with "next", without a new page): the Micrio viewer's images named in the page's data —
// "micrio":{"shortId":"DMfki"…}, also as escaped JSON — → their IIIF image, 2400 px wide (the original can be 10,000 px
// and over the size limit; a reference image is made smaller anyway).
function viewerPictures(html) {
  const ids = new Set();
  for (const m of html.matchAll(/micrio\\?"\s*:\s*\{\s*\\?"shortId\\?"\s*:\s*\\?"([A-Za-z0-9]{3,20})\\?"/g)) ids.add(m[1]);
  return [...ids].map((id) => `https://iiif.micr.io/${id}/full/2400,/0/default.jpg`);
}

module.exports = { fetchPublic, picturesOn, galleryPictures, viewerPictures, blocked, FetchError, MAX_BYTES };
