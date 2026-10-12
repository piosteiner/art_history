// Answers of outside services (Wikidata, the GND, SIKART, OpenStreetMap), kept for a while: a comparison's Apply then
// works with exactly the record that was shown — not a newer one — and needn't ask again; reopening a comparison is
// quick. Concurrent requests for the same key share one fetch; a failure is not kept (the next try asks again).
// Per server process, in memory: a restart (deploy) forgets everything.
function memo({ ttl = 15 * 60 * 1000, max = 500 } = {}) {
  const cache = new Map();  // key → { at, value: Promise }
  return async function remember(key, fetch) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = Promise.resolve().then(fetch);
    cache.delete(key);
    cache.set(key, { at: Date.now(), value });
    // the oldest out first (a Map keeps insertion order)
    if (cache.size > max) cache.delete(cache.keys().next().value);
    try {
      return await value;
    } catch (err) {
      if (cache.get(key) && cache.get(key).value === value) cache.delete(key);
      throw err;
    }
  };
}

module.exports = { memo };
