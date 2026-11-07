// Emotes in the chats (240, owner 2026-11-07 — as on the adenai map): 7TV emote sets → name → picture. Ported from
// adenai-map server/routes/emotes.js: a 7TV or Twitch user name follows the channel's active set (Twitch first), a 7TV
// set link or id that set, "global" 7TV's global emotes; among the sources the first wins a name. Names with a colon
// (":3", "D:") go without it (:3:). A source that can't be fetched keeps its emotes from before.
const { request, UA } = require('./http');

const API = 'https://7tv.io/v3';
const validName = (n) => /^[^\s:]{1,64}$/.test(n);

async function get7tv(path, body) {
  const res = body
    ? await fetch(`${API}${path}`, { method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
    : await request(`${API}${path}`);
  if (!res.ok) throw new Error(`7TV answered ${res.status}`);
  return res.json();
}

// a user name → the 7TV user and the emote set active on their channel
async function userSet(name) {
  const key = name.toLowerCase();
  const { data } = await get7tv('/gql', {
    query: 'query($q:String!){users(query:$q){id username connections{platform username emote_set_id}}}',
    variables: { q: name },
  });
  const users = (data && data.users) || [];
  const user = users.find((u) => u.username.toLowerCase() === key) || users.find((u) => u.connections.some((c) => c.username.toLowerCase() === key));
  if (!user) throw new Error(`No 7TV user “${name}”`);
  const order = ['TWITCH', 'KICK', 'YOUTUBE', 'DISCORD'];
  const conn = user.connections.filter((c) => c.emote_set_id).sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform))[0];
  if (!conn) throw new Error(`7TV user “${user.username}” has no active emote set`);
  return { name: user.username, setId: conn.emote_set_id };
}

/** What was typed in the CMS → a source: "global", a 7TV link (user or emote set), a set id, or a user name. */
async function parseSource(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('Enter a 7TV or Twitch name, a 7TV link or a set id');
  if (/^global$/i.test(s)) return { type: 'global' };
  const set = /7tv\.app\/emote-sets\/([0-9A-Za-z]+)/.exec(s);
  if (set) return { type: 'set', setId: set[1] };
  const user = /7tv\.app\/users\/([0-9A-Za-z]+)/.exec(s);
  if (user) return { type: 'user', name: (await get7tv(`/users/${user[1]}`)).username };
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(s)) return { type: 'set', setId: s.toUpperCase() };
  return { type: 'user', name: s.replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/\/.*$/, '') };
}

const labelOf = (src) => (src.type === 'user' ? src.name : src.type === 'global' ? 'global' : src.setName || src.setId);
/** a source as stored: what identifies it, nothing fetched */
const plain = (s) => (s.type === 'user' ? { type: 'user', name: s.name } : s.type === 'set' ? { type: 'set', setId: s.setId } : { type: 'global' });

// a source → { source (with set name and count), emotes }
async function fetchSource(src) {
  const out = { ...plain(src) };
  if (src.type === 'user') Object.assign(out, await userSet(src.name));
  const data = await get7tv(src.type === 'global' ? '/emote-sets/global' : `/emote-sets/${out.setId}`);
  out.setId = data.id;
  out.setName = data.name;
  const emotes = {};
  const all = data.emotes || [];
  const named = all.filter((e) => validName(e.name)).map((e) => [e.name, e]);
  const colons = all.filter((e) => !validName(e.name)).map((e) => [e.name.replace(/:/g, '').trim(), e, e.name]).filter(([n]) => validName(n));
  for (const [name, e, original] of [...named, ...colons]) {
    if (emotes[name]) continue;
    const files = (e.data && e.data.host && e.data.host.files) || [];
    const small = files.find((f) => f.name === '1x.webp') || files[0] || {};
    emotes[name] = { url: `https://cdn.7tv.app/emote/${e.id}/2x.webp`, w: small.width || 28, h: small.height || 28, animated: !!(e.data && e.data.animated), from: labelOf(out), ...(original ? { original } : {}) };
  }
  out.count = Object.keys(emotes).length;
  return { source: out, emotes };
}

/** sources → { sources (with set name, count or error), emotes }; `previous`: the emotes before, kept for a source that fails */
async function build(sources, previous = {}) {
  const results = await Promise.all(sources.map((s) => fetchSource(s).catch((err) => ({ source: { ...s, error: err.message }, emotes: null }))));
  const emotes = {};
  for (const r of results) {
    const own = r.emotes || Object.fromEntries(Object.entries(previous).filter(([, e]) => e.from === labelOf(r.source)));
    for (const [name, e] of Object.entries(own)) if (!emotes[name]) emotes[name] = e;
  }
  return { sources: results.map((r) => r.source), emotes };
}

async function load(db) {
  const { rows: [row] } = await db.query('SELECT sources, emotes, fetched_at, updated_at FROM chat_emotes WHERE id = 1');
  return row || { sources: [], emotes: {}, fetched_at: null, updated_at: null };
}

/** the sources fetched (outside a transaction: 7TV may take a while), then written in `db` (withTx: audited as the user) */
async function refresh(sources, previous) { return build(sources.map(plain), previous); }
async function write(db, built) {
  await db.query(`INSERT INTO chat_emotes (id, sources, emotes, fetched_at, updated_at) VALUES (1, $1, $2, now(), now())
    ON CONFLICT (id) DO UPDATE SET sources = EXCLUDED.sources, emotes = EXCLUDED.emotes, fetched_at = now(),
      updated_at = CASE WHEN chat_emotes.sources = EXCLUDED.sources AND chat_emotes.emotes = EXCLUDED.emotes THEN chat_emotes.updated_at ELSE now() END`,
  [JSON.stringify(built.sources), JSON.stringify(built.emotes)]);
}

module.exports = { parseSource, fetchSource, build, load, refresh, write, plain, labelOf };
