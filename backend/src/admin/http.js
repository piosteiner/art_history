// Requests to outside services — Wikidata and Commons, the authority files, museums' and libraries' databases,
// OpenStreetMap: one User-Agent naming the project and how to reach it (Wikimedia's and Nominatim's usage policies ask
// for one), a time limit, an error that names the service. A "429 Too Many Requests" whose Retry-After asks for at most
// 10 seconds is waited out once, so a single burst doesn't fail a whole comparison.
const UA = 'arthistory.piogino.ch admin (research database; +https://arthistory.piogino.ch)';
const MAX_WAIT = 10;  // seconds of Retry-After still worth waiting for

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function request(url, { accept = 'application/json', headers = {}, timeout = 15000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, ...headers }, signal: AbortSignal.timeout(timeout) });
    const wait = Number(res.headers.get('retry-after') ?? 1);  // seconds (an HTTP date reads NaN: not waited for)
    if (res.status !== 429 || attempt > 0 || !(wait >= 0 && wait <= MAX_WAIT)) return res;
    await sleep(Math.max(1, wait) * 1000);
  }
}

/**
 * The answer as JSON. `name`: the service in error messages (default: the host); `missing`: what a 404 gives instead
 * of an error — a value, or a function (to throw a message of its own).
 */
async function getJson(url, { name, missing, ...options } = {}) {
  const res = await request(url, options);
  if (res.status === 404 && missing !== undefined) return typeof missing === 'function' ? missing() : missing;
  if (!res.ok) throw new Error(`${name || new URL(url).host} answered ${res.status}`);
  return res.json();
}

module.exports = { getJson, request, UA };
