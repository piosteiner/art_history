// Admin panel — search words (migration 102): groups of words that mean the same in German, English, French …; the
// public full-text search finds each word of a group by the others ("beschlagnahmt" → "confiscation"). The rules the
// search uses are rebuilt by a trigger on every save, so a change works at once. "Try a word" shows which groups a
// word falls into — as the search reads it (stemmed: "verkaufte" is "verkauft").
// Mounted by src/admin/index.js before the entry pages (/search-words is not a /:plural).
const express = require('express');
const { adminPool } = require('../../db');
const { html } = require('../html');
const { send, withTx, notFoundPage, friendly } = require('../core');

const router = express.Router();
const SITE = process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch';
const BACK = html`<p class="muted"><a href="/search-words">← Search words</a></p>`;

// one word per line or comma-separated → trimmed, without empties and repeats (case-insensitive, first spelling kept)
function parseTerms(text) {
  const seen = new Set();
  return String(text || '').split(/[\n,;]+/).map((t) => t.trim().replace(/\s+/g, ' ')).filter((t) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// the groups a word (or several) falls into, as the search reads them: same lexeme in any configuration (087).
// Phrases are only equivalents (102), so only one-word terms are compared.
const GROUPS_OF = `
  SELECT DISTINCT s.id, s.label, s.terms FROM search_synonyms s, unnest(s.terms) t(term), unnest(search_lexemes(t.term)) a,
         unnest($1::text[]) w(word), unnest(search_lexemes(w.word)) b
  WHERE a.lexeme = b.lexeme AND t.term !~ '[[:space:]-]' AND w.word !~ '[[:space:]-]' AND s.id IS DISTINCT FROM $2::bigint
  ORDER BY s.label`;

function form({ action, v = {}, submit, shared = [] }) {
  const val = (k) => v[k] ?? '';
  const terms = Array.isArray(v.terms) ? v.terms.join('\n') : val('terms');
  return html`<form method="post" action="${action}" class="form search-words-form">
    <div class="field"><label for="sw-label">Meaning</label><input id="sw-label" name="label" value="${val('label')}" required placeholder="e.g. confiscation">
      <div class="hint">What the words have in common — for you, it isn't searched.</div></div>
    <div class="field"><label for="sw-terms">Words</label>
      <textarea id="sw-terms" name="terms" rows="10" required spellcheck="false" placeholder="beschlagnahmt&#10;confiscation&#10;seized&#10;saisie">${terms}</textarea>
      <div class="hint">One per line (or separated by commas), in any language. Each finds all the others. Word forms count
        once: the search reduces “beschlagnahmte” and “beschlagnahmt” to one stem, but list the noun and the verb
        (“Beschlagnahme”, “beschlagnahmt”) — they have different stems. A phrase (“forced sale”) is found when another
        word of the group is searched, but searching the phrase itself doesn't use the group. Avoid words with another
        meaning elsewhere (“vol” = theft, but also volume).</div></div>
    ${shared.length ? html`<div class="flash warn search-words-shared"><b>Shares words with other groups:</b>
      <ul>${shared.map((g) => html`<li><a href="/search-words/${g.id}/edit">${g.label}</a> — ${g.terms.join(', ')}</li>`)}</ul>
      A word in two groups finds the words of both. Merge them if they mean the same.</div>` : ''}
    <div class="field"><label for="sw-note">Note</label><input id="sw-note" name="note" value="${val('note')}" placeholder="optional: why, or a source for the translations"></div>
    <div class="actions"><button>${submit}</button> <a class="button secondary" href="/search-words">Cancel</a></div></form>`;
}

function fromBody(body) {
  const label = String(body.label || '').trim();
  if (!label) throw new Error('Say what the words mean (e.g. “confiscation”).');
  const terms = parseTerms(body.terms);
  if (terms.length < 2) throw new Error('A group needs at least two words.');
  return { label, terms, note: String(body.note || '').trim() || null };
}
const saveError = (err) => (err.constraint === 'search_synonyms_label_key' ? 'There is already a group with this meaning — add the words there.'
  : err.message && !err.code ? err.message : friendly(err));

async function byId(id) {
  if (!/^\d+$/.test(id)) return null;
  return (await adminPool.query('SELECT * FROM search_synonyms WHERE id = $1', [id])).rows[0] || null;
}

router.get('/search-words', async (req, res) => {
  const tryWord = String(req.query.try || '').trim().slice(0, 100);
  const { rows } = await adminPool.query('SELECT * FROM search_synonyms ORDER BY label COLLATE sort_natural');
  const found = tryWord ? (await adminPool.query(GROUPS_OF, [parseTerms(tryWord), null])).rows : [];
  send(req, res, { title: 'Search words', body: html`<h1>Search words</h1>
    <p class="muted">Groups of words that mean the same in different languages. The public search finds every word of a
      group by any other: “beschlagnahmt” finds the provenance steps that say “confiscation” or “seized”. A change works
      at once.</p>
    <form method="get" action="/search-words" class="inline search-words-try">
      <label for="sw-try">Try a word</label> <input id="sw-try" type="search" name="try" value="${tryWord}" placeholder="e.g. verkaufte">
      <button>Check</button></form>
    ${tryWord ? html`<div class="search-words-result">${found.length
      ? html`<p>“${tryWord}” also finds: ${found.map((g, i) => html`${i ? ' · ' : ''}<a href="/search-words/${g.id}/edit">${g.label}</a> (${g.terms.join(', ')})`)}</p>`
      : html`<p>“${tryWord}” is in no group: the search finds only the word itself (and its forms).</p>`}
      <p class="small"><a href="${SITE}/search?${String(new URLSearchParams({ q: tryWord }))}" target="_blank" rel="noopener">Search the site for “${tryWord}” ↗</a></p></div>` : ''}
    <p class="actions"><a class="button" href="/search-words/new">+ New group</a></p>
    ${rows.length ? html`<div class="table-wrap"><table class="search-words-list"><thead><tr><th>Meaning</th><th>Words</th><th>Note</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><a href="/search-words/${r.id}/edit">${r.label}</a></td><td>${r.terms.join(', ')}</td><td class="muted">${r.note || ''}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted">No groups yet — the search finds words only in their own language.</p>`}` });
});

router.get('/search-words/new', (req, res) => {
  send(req, res, { title: 'New search words', body: html`${BACK}<h1>New group of search words</h1>${form({ action: '/search-words', submit: 'Create' })}` });
});

router.post('/search-words', async (req, res) => {
  let row;
  try {
    const v = fromBody(req.body);
    row = await withTx(req.user, async (db) => (await db.query(
      'INSERT INTO search_synonyms (label, terms, note) VALUES ($1, $2, $3) RETURNING id', [v.label, v.terms, v.note])).rows[0]);
  } catch (err) {
    return send(req, res, { title: 'New search words', status: 422, flash: { kind: 'error', text: saveError(err) },
      body: html`${BACK}<h1>New group of search words</h1>${form({ action: '/search-words', v: req.body, submit: 'Create' })}` });
  }
  res.redirect(303, `/search-words/${row.id}/edit?done=created`);
});

router.get('/search-words/:id/edit', async (req, res) => {
  const g = await byId(req.params.id);
  if (!g) return notFoundPage(req, res);
  const shared = (await adminPool.query(GROUPS_OF, [g.terms, g.id])).rows;
  send(req, res, { title: `Search words: ${g.label}`, body: html`${BACK}<h1>${g.label}</h1>
    ${form({ action: `/search-words/${g.id}`, v: g, submit: 'Save', shared })}
    <form method="post" action="/search-words/${g.id}/delete" class="actions" style="margin-top:1.5rem"><button class="danger">Delete this group</button></form>
    <p class="muted small">Every change is in the <a href="/history">History</a> and can be reverted there.</p>` });
});

router.post('/search-words/:id', async (req, res) => {
  const g = await byId(req.params.id);
  if (!g) return notFoundPage(req, res);
  try {
    const v = fromBody(req.body);
    await withTx(req.user, (db) => db.query('UPDATE search_synonyms SET label = $2, terms = $3, note = $4, updated_at = now() WHERE id = $1',
      [g.id, v.label, v.terms, v.note]));
  } catch (err) {
    return send(req, res, { title: `Search words: ${g.label}`, status: 422, flash: { kind: 'error', text: saveError(err) },
      body: html`${BACK}<h1>${g.label}</h1>${form({ action: `/search-words/${g.id}`, v: req.body, submit: 'Save' })}` });
  }
  res.redirect(303, `/search-words/${g.id}/edit?done=saved`);
});

router.post('/search-words/:id/delete', async (req, res) => {
  const g = await byId(req.params.id);
  if (!g) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM search_synonyms WHERE id = $1', [g.id]));
  res.redirect(303, '/search-words?done=deleted');
});

module.exports = router;
module.exports.parseTerms = parseTerms;
