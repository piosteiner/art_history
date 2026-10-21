// Whole answers of the API cached per data version — for answers that sum up the whole database and look the same for
// every visitor (the start map's presence, the periods timeline). The version is the change counter (quality_changes,
// 058) — but only while the derived data is current (quality_fresh(), 125–127): those answers read the stored graph
// and the list rows, which the worker brings up to date a moment after a change; cached in between, a stale answer
// would carry the new version. Not current: computed every time, not cached.
// In production the answers registered with warm() are computed ahead once the data is current after a change, so
// the first visitor finds them ready.
const { apiPool } = require('./db');

const dataVersion = async () => (await apiPool.query(
  'SELECT CASE WHEN quality_fresh() THEN last_value::text END AS v FROM quality_changes')).rows[0].v;

// A cache of at most `max` answers (the least used dropped): cached(key, compute) → the answer as JSON text.
function versioned(max) {
  const answers = new Map();   // key → { version, body }; the Map's order is the order of use
  return async (key, compute) => {
    const version = await dataVersion();
    const hit = version && answers.get(key);
    if (hit && hit.version === version) {
      answers.delete(key);
      answers.set(key, hit);
      return hit.body;
    }
    const body = JSON.stringify(await compute());
    if (version) {
      answers.delete(key);
      answers.set(key, { version, body });
      for (const k of answers.keys()) { if (answers.size <= max) break; answers.delete(k); }
    }
    return body;
  };
}

const warmers = [];
let warmed = null;
// fn: computes (and so caches) an answer; run after every change, once the data is current
function warm(name, fn) { warmers.push({ name, fn }); }
async function warmAll() {
  const version = await dataVersion();
  if (!version || version === warmed) return;
  for (const w of warmers) await w.fn().catch((err) => console.error(`cache: warming ${w.name} —`, err.message));
  warmed = version;
}
if (process.env.NODE_ENV === 'production') {
  setInterval(() => warmAll().catch((err) => console.error('cache: warm-up —', err.message)), 15000).unref();
}

module.exports = { dataVersion, versioned, warm };
