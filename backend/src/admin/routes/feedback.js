// Admin panel — feedback from visitors of the site (migration 141; sent with the "F" button, frontend/src/feedback.ts).
//   /feedback[?status=open|planned|done|dismissed|all]   newest first; each with its page ("Open on the site" outlines
//                        the elements it is about: #fb=<selectors>), the elements in words, the message, an address
//                        if one was given; status, a note of your own, "Add to roadmap" (an unpublished item in Später,
//                        linked back), delete.
// Feedback is not audited (no history): deleting it removes it, an address with it. Mounted by src/admin/index.js.
const express = require('express');
const { adminPool } = require('../../db');
const { html } = require('../html');
const { send, withTx, notFoundPage } = require('../core');
const counts = require('../feedback-count');

const router = express.Router();
const SITE = process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch';
const idOk = (s) => /^\d{1,15}$/.test(String(s));
const KIND = { bug: 'Bug', idea: 'Idea', content: 'Content', other: 'Other' };
const STATUS = { new: 'new', read: 'read', planned: 'on the roadmap', done: 'done', dismissed: 'dismissed' };
const TABS = { open: ['new', 'read'], planned: ['planned'], done: ['done'], dismissed: ['dismissed'], all: Object.keys(STATUS) };
const WHEN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });

// the page on the site with the chosen elements outlined (frontend: highlightFeedback in feedback.ts)
function siteLink(f) {
  const path = f.page_url.split('#')[0];
  const selectors = (f.elements || []).map((e) => e.selector).filter(Boolean);
  return `${SITE}${path}${selectors.length ? `#fb=${encodeURIComponent(JSON.stringify(selectors))}` : ''}`;
}

const card = (f, tab) => html`<article class="feedback-card fb-${f.status}" id="feedback-${String(f.id)}">
  <header class="feedback-head">
    <span class="tag fb-kind fb-kind-${f.kind}">${KIND[f.kind]}</span>
    <span class="muted small">#${String(f.id)} · ${WHEN.format(f.created_at)}${f.viewport ? ` · screen ${f.viewport}` : ''}</span>
    <span class="tag fb-status">${STATUS[f.status]}</span>
  </header>
  <p class="feedback-page">On <a href="${siteLink(f)}" target="_blank" rel="noopener">${f.page_title || f.page_url} ↗</a>
    <span class="muted small">${f.page_url}</span></p>
  ${f.elements && f.elements.length ? html`<ol class="feedback-elements">${f.elements.map((e) => html`<li>
      <b>${e.label || 'element'}</b>${e.heading ? html` <span class="muted">in “${e.heading}”</span>` : ''}${e.text ? html` — <q>${e.text}</q>` : ''}</li>`)}</ol>` : ''}
  <blockquote class="feedback-message">${f.message}</blockquote>
  ${f.email ? html`<p class="small">Answer to: <a href="mailto:${f.email}">${f.email}</a></p>` : ''}
  ${f.roadmap_item_id ? html`<p class="small">On the roadmap: <a href="/roadmap/${String(f.roadmap_item_id)}/edit">${f.roadmap_title || `item ${f.roadmap_item_id}`}</a></p>` : ''}
  <form method="post" action="/feedback/${String(f.id)}/note" class="feedback-note">
    <input type="hidden" name="tab" value="${tab}">
    <label class="small muted" for="fb-note-${String(f.id)}">Your note</label>
    <textarea id="fb-note-${String(f.id)}" name="note_md" rows="2">${f.note_md || ''}</textarea>
    <button class="secondary small">Save note</button></form>
  <div class="feedback-actions">
    ${['read', 'done', 'dismissed', 'new'].filter((s) => s !== f.status).map((s) => html`<form method="post" action="/feedback/${String(f.id)}/status" class="inline">
      <input type="hidden" name="tab" value="${tab}"><button name="status" value="${s}" class="secondary small">${{ read: 'Mark read', done: 'Done', dismissed: 'Dismiss', new: 'Mark new' }[s]}</button></form>`)}
    ${f.roadmap_item_id ? '' : html`<form method="post" action="/feedback/${String(f.id)}/roadmap" class="inline"><button class="small">+ Add to roadmap</button></form>`}
    <form method="post" action="/feedback/${String(f.id)}/delete" class="inline" data-confirm="Delete feedback #${String(f.id)}? It is gone for good (feedback has no history)."><button class="link small">delete</button></form>
  </div>
</article>`;

router.get('/feedback', async (req, res) => {
  const tab = TABS[req.query.status] ? req.query.status : 'open';
  await counts.refresh();   // the menu's number up to date on this page (feedback arrives through the API)
  const { rows } = await adminPool.query(`SELECT f.*, r.title AS roadmap_title FROM feedback f LEFT JOIN roadmap_items r ON r.id = f.roadmap_item_id
    WHERE f.status::text = ANY($1) ORDER BY f.created_at DESC LIMIT 200`, [TABS[tab]]);
  const { rows: n } = await adminPool.query('SELECT status::text AS status, count(*)::int AS n FROM feedback GROUP BY 1');
  const count = Object.fromEntries(n.map((r) => [r.status, r.n]));
  const inTab = (t) => TABS[t].reduce((s, st) => s + (count[st] || 0), 0);
  send(req, res, { title: 'Feedback', body: html`<h1>Feedback</h1>
    <p class="muted">What visitors sent with the “F” button on the site — about a page, or about elements they picked on it.
      “Open on the site” shows the page with those elements outlined. Feedback has no history: deleted is gone.</p>
    <nav class="feedback-tabs">${Object.keys(TABS).map((t) => html`<a href="/feedback?status=${t}"${t === tab ? html` aria-current="page" class="on"` : ''}>${{ open: 'Open', planned: 'On the roadmap', done: 'Done', dismissed: 'Dismissed', all: 'All' }[t]} <span class="muted">${String(inTab(t))}</span></a>`)}</nav>
    ${rows.length ? html`${rows.map((f) => card(f, tab))}` : html`<p class="muted">Nothing here.</p>`}` });
});

const back = (req, id) => `/feedback?status=${TABS[req.body.tab] ? req.body.tab : 'open'}#feedback-${id}`;

router.post('/feedback/:id/status', async (req, res) => {
  if (!idOk(req.params.id) || !STATUS[req.body.status]) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('UPDATE feedback SET status = $2 WHERE id = $1 AND status <> $2::feedback_status', [req.params.id, req.body.status]));
  counts.refresh();
  res.redirect(303, back(req, req.params.id));
});

router.post('/feedback/:id/note', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  const note = String(req.body.note_md || '').trim() || null;
  // a note means it was read
  await withTx(req.user, (db) => db.query(`UPDATE feedback SET note_md = $2, status = CASE WHEN status = 'new' THEN 'read' ELSE status END
    WHERE id = $1`, [req.params.id, note]));
  counts.refresh();
  res.redirect(303, back(req, req.params.id));
});

// an unpublished roadmap item in "Später" from the feedback — its first line as the title, the message quoted as the
// notes — linked back; then its edit page, to word it for the roadmap
router.post('/feedback/:id/roadmap', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  const itemId = await withTx(req.user, async (db) => {
    const { rows: [f] } = await db.query('SELECT * FROM feedback WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!f) return null;
    if (f.roadmap_item_id) return f.roadmap_item_id;
    const first = f.message.split('\n').map((l) => l.trim()).find(Boolean) || 'Feedback';
    const title = first.length > 90 ? `${first.slice(0, 87).replace(/\s+\S*$/, '')} …` : first;
    const notes = `From feedback #${f.id} on ${f.page_url}:\n\n${f.message.split('\n').map((l) => `> ${l}`).join('\n')}`;
    const { rows: [r] } = await db.query(`INSERT INTO roadmap_items (title, notes_md, status, published, position)
      VALUES ($1, $2, 'spaeter', false, (SELECT coalesce(max(position), 0) + 10 FROM roadmap_items WHERE status = 'spaeter')) RETURNING id`, [title, notes]);
    await db.query("UPDATE feedback SET roadmap_item_id = $2, status = 'planned' WHERE id = $1", [f.id, r.id]);
    return r.id;
  });
  if (!itemId) return notFoundPage(req, res);
  counts.refresh();
  res.redirect(303, `/roadmap/${itemId}/edit?done=from-feedback`);
});

router.post('/feedback/:id/delete', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM feedback WHERE id = $1', [req.params.id]));
  counts.refresh();
  res.redirect(303, `/feedback?status=${TABS[req.body.tab] ? req.body.tab : 'open'}&done=deleted`);
});

module.exports = router;
