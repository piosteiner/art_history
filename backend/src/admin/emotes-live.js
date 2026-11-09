// Emotes in the chats follow the 7TV sets live (owner 2026-11-09, as on the adenai map and movies.piogino.ch):
// 7TV's event feed (events.7tv.io, server-sent events) reports every change to an emote set ("dispatch", type
// emote_set.update). A few seconds after one, the sources are fetched again (src/admin/emotes.js) and written to
// chat_emotes — only when the emotes really changed, as source '7tv live' (audit_log shows it without a user).
// One connection per set; reopened when it drops or heartbeats stop. A refresh at start and every 30 minutes
// covers a dropped feed and a channel switching to another set. Production only (server.js).
const emotes = require('./emotes');

const EVENTS = process.env.SEVENTV_EVENTS || 'https://events.7tv.io/v3';
const CHECK_EVERY = 30 * 60_000;
const SETTLE_MS = 5000; // several changes in a row: one refresh

let pool = null;
let log = console;
let refreshTimer = null;
let interval = null;
const feeds = new Map(); // setId → AbortController

/** the sources fetched again; written when the emotes or the sources' sets changed. → { changed, count, added, removed } */
async function refreshNow(db = pool) {
  const before = await emotes.load(db);
  if (!before.sources.length) return { changed: false, count: 0 };
  const built = await emotes.refresh(before.sources, before.emotes);
  const sameEmotes = JSON.stringify(before.emotes) === JSON.stringify(built.emotes);
  const sameSets = JSON.stringify(before.sources.map((s) => [s.setId, s.count])) === JSON.stringify(built.sources.map((s) => [s.setId, s.count]));
  const count = Object.keys(built.emotes).length;
  if (sameEmotes && sameSets) return { changed: false, count };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('arthistory.source', '7tv live', true)");
    await emotes.write(client, built);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const added = Object.keys(built.emotes).filter((n) => !before.emotes[n]).length;
  const removed = Object.keys(before.emotes).filter((n) => !built.emotes[n]).length;
  return { changed: true, count, added, removed };
}

function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const r = await refreshNow();
      if (r.changed) log.log(`Emotes: 7TV changed — now ${r.count} (+${r.added} −${r.removed})`);
      await sync();
    } catch (err) { log.error('Emotes live refresh:', err.message); }
  }, SETTLE_MS);
}

/** splits a server-sent event stream: onEvent(name, data) for every complete block */
function eventParser(onEvent) {
  let buf = '';
  return (text) => {
    buf += text.replace(/\r\n/g, '\n');
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const name = (/^event: *(.*)$/m.exec(block) || [])[1];
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (name) onEvent(name, data);
    }
  };
}

async function follow(setId, retry = 0) {
  const abort = new AbortController();
  feeds.set(setId, abort);
  let beat = 60_000;
  let watchdog = null;
  const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(() => abort.abort(), beat * 2 + 5000); };
  try {
    const res = await fetch(`${EVENTS}@${encodeURIComponent(`emote_set.update<object_id=${setId}>`)}`, {
      headers: { Accept: 'text/event-stream' }, signal: abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`7TV events answered ${res.status}`);
    retry = 0;
    alive();
    const decoder = new TextDecoder();
    const feed = eventParser((name, data) => {
      if (name === 'hello') { try { beat = JSON.parse(data).heartbeat_interval || beat; } catch { /* keep */ } }
      else if (name === 'dispatch') { try { if (JSON.parse(data).type === 'emote_set.update') refreshSoon(); } catch { /* not ours */ } }
    });
    for await (const chunk of res.body) { alive(); feed(decoder.decode(chunk, { stream: true })); }
  } catch (err) {
    if (feeds.get(setId) !== abort) return; // stopped or replaced
    if (err.name !== 'AbortError') log.error(`Emotes live (${setId}):`, err.message);
  } finally {
    clearTimeout(watchdog);
  }
  if (feeds.get(setId) !== abort) return;
  // dropped: back after 5 s, 10 s … at most 5 minutes; a refresh catches what was missed meanwhile
  setTimeout(() => {
    if (feeds.get(setId) !== abort) return;
    refreshSoon();
    follow(setId, retry + 1);
  }, Math.min(300_000, 5000 * 2 ** retry));
}

/** follows exactly the sets the stored sources point at now (also after the Emotes page changed them) */
async function sync() {
  if (!pool) return;
  let ids;
  try { ids = [...new Set((await emotes.load(pool)).sources.map((s) => s.setId).filter(Boolean))]; } catch (err) { log.error('Emotes live:', err.message); return; }
  for (const [id, abort] of feeds) if (!ids.includes(id)) { feeds.delete(id); abort.abort(); }
  for (const id of ids) if (!feeds.has(id)) follow(id);
}

function start(adminPool, { logger = console } = {}) {
  pool = adminPool;
  log = logger;
  sync();
  refreshSoon(); // what changed while the server was down
  interval = setInterval(refreshSoon, CHECK_EVERY);
  interval.unref();
}

function stop() {
  for (const abort of feeds.values()) abort.abort();
  feeds.clear();
  clearTimeout(refreshTimer);
  clearInterval(interval);
  pool = null;
}

module.exports = { start, stop, sync, refreshNow, eventParser };
