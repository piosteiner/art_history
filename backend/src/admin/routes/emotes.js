// Admin panel — emotes in the chats (240, owner 2026-11-07, as on the adenai map): the 7TV sources, their emotes, and
// "Refresh" (7TV fetched again — a channel's active set may have changed). Admins only: what every chat shows.
const express = require('express');
const { adminPool } = require('../../db');
const { html } = require('../html');
const { send, withTx } = require('../core');
const emotes = require('../emotes');

const router = express.Router();
router.use('/emotes', (req, res, next) => (req.user.is_admin ? next()
  : send(req, res, { title: 'Emotes', status: 403, body: html`<h1>Emotes</h1><p>Only admins change the chats' emotes.</p>` })));

const OK = { added: 'Source added and fetched.', removed: 'Source removed.', refreshed: 'Fetched again from 7TV.', moved: 'Order changed.' };
const label = (s) => (s.type === 'user' ? html`👤 ${s.name}` : s.type === 'global' ? '🌐 7TV global emotes' : html`🗂 Set ${s.setName || s.setId}`);

async function page(req, res, { error = null, status = 200 } = {}) {
  const e = await emotes.load(adminPool);
  const all = Object.entries(e.emotes).sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const flash = error ? { kind: 'error', text: error } : OK[req.query.ok] ? { kind: 'ok', text: OK[req.query.ok] } : null;
  send(req, res, { title: 'Emotes', status, flash, body: html`<h1>Emotes in the chats</h1>
    <p class="muted">Write <code>:name:</code> in a chat message — friends' chats and sets' chats on the site — and it shows the emote, as in a Twitch chat;
      typing <code>:</code> and a few letters offers them. Only in the chats, nowhere else. From 7TV: a 7TV or Twitch name follows that channel's
      active emote set, a 7TV set link or id that set, <code>global</code> 7TV's global emotes. When two sources have the same name, the upper one wins.</p>
    <h2>Sources</h2>
    ${e.sources.length ? html`<ol class="emote-sources">${e.sources.map((s, i) => html`<li><b>${label(s)}</b>
      <span class="muted">${s.error ? '' : [s.type === 'user' && s.setName ? `set “${s.setName}”` : '', s.count != null ? `${String(s.count)} emotes` : ''].filter(Boolean).join(' · ')}</span>
      ${s.error ? html`<span class="error">⚠ ${s.error}</span>` : ''}
      ${i > 0 ? html`<form method="post" action="/emotes/move" class="inline"><input type="hidden" name="i" value="${String(i)}"><button class="link" title="Up: wins a name two sources share">↑ up</button></form>` : ''}
      <form method="post" action="/emotes/remove" class="inline"><input type="hidden" name="i" value="${String(i)}"><button class="link danger">Remove</button></form></li>`)}</ol>`
      : html`<p class="muted">No source yet — the chats show <code>:name:</code> as text.</p>`}
    <form method="post" action="/emotes/add" class="form inline-form"><label>Add <input name="input" placeholder="7TV or Twitch name, 7TV link, set id or “global”" size="44" required></label> <button>Add</button></form>
    <form method="post" action="/emotes/refresh" class="inline"><button class="secondary">↻ Refresh from 7TV</button></form>
    <p class="muted small">${e.fetched_at ? html`Last fetched ${e.fetched_at.toLocaleString('de-CH', { timeZone: 'Europe/Zurich' })}.` : 'Not fetched yet.'}</p>
    <h2>${String(all.length)} emotes</h2>
    <div class="emote-grid">${all.map(([name, x]) => html`<figure title=":${name}: — ${x.from}"><img src="${x.url}" alt="" loading="lazy" height="28"><figcaption>${name}</figcaption></figure>`)}</div>` });
}

router.get('/emotes', (req, res) => page(req, res));

/** the new list of sources → fetched → written; back to the page */
async function apply(req, res, sources, ok) {
  const before = await emotes.load(adminPool);
  const built = await emotes.refresh(sources, before.emotes);
  await withTx(req.user, (db) => emotes.write(db, built));
  require('../emotes-live').sync(); // the sources may have changed: follow their sets (production only)
  res.redirect(303, `/emotes?ok=${ok}`);
}
const index = (req, list) => { const i = Number(req.body.i); return Number.isInteger(i) && i >= 0 && i < list.length ? i : -1; };

router.post('/emotes/add', async (req, res) => {
  const { sources } = await emotes.load(adminPool);
  let src;
  try { src = (await emotes.fetchSource(await emotes.parseSource(req.body.input))).source; } catch (err) { return page(req, res, { error: err.message, status: 422 }); }
  if (sources.some((s) => JSON.stringify(emotes.plain(s)) === JSON.stringify(emotes.plain(src)))) return page(req, res, { error: 'That source is there already.', status: 422 });
  return apply(req, res, [...sources, src], 'added');
});
router.post('/emotes/remove', async (req, res) => {
  const { sources } = await emotes.load(adminPool);
  const i = index(req, sources);
  if (i < 0) return res.redirect(303, '/emotes');
  return apply(req, res, sources.filter((_, k) => k !== i), 'removed');
});
router.post('/emotes/move', async (req, res) => {
  const { sources } = await emotes.load(adminPool);
  const i = index(req, sources);
  if (i < 1) return res.redirect(303, '/emotes');
  const list = [...sources];
  list.splice(i - 1, 0, ...list.splice(i, 1));
  return apply(req, res, list, 'moved');
});
router.post('/emotes/refresh', async (req, res) => apply(req, res, (await emotes.load(adminPool)).sources, 'refreshed'));

module.exports = router;
