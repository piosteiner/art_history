// Names in several languages and scripts — shared by the server (content model, API) and the admin's browser bundle.
//
// Furigana / ruby: written inline as {base|reading}, e.g. {神奈川|かながわ}{沖|おき}{浪裏|なみうら}
//   plain()   → 神奈川沖浪裏           (stored as the name; what lists, search and the API's `name` show)
//   reading() → かながわおきなみうら   (search, Japanese sorting)
//   rubyHtml() → <ruby>神奈川<rt>かながわ</rt></ruby>…  (escaped; for display)
// The same markup works for any ruby: pinyin or zhuyin over Chinese, etc. SQL twins: ruby_plain(), ruby_reading().
//
// Languages: BCP 47 tags — ja, en, de, zh-Hant; romanizations are the language in Latin script: ja-Latn,
// zh-Latn-pinyin, ru-Latn. normLang() fixes the case (JA-latn → ja-Latn).
//
// Other names (column `names`, jsonb): [{text, lang?, role, status?, period?, period_label?, note?}], role = original |
// translation | romanization | alternative | former (a name the entry had before — a renamed institution, an old place
// name; 139). Context (152): when the name was in use — a fuzzy date like any other ("until 1945", "1912–1940"), stored
// as the daterange `period` with its `period_label` — and a `note` ("renamed … in 1945"). The database keeps each name
// as a row of entry_names too, which sources can cite.
// In forms one per line: "text | lang | role | period | note" — all but the text optional ("Hokusai" alone = an
// alternative name); the note is the rest of the line.
const { parseFuzzyDate } = require('./fuzzy-date');

const GROUP = /\{([^{}|]+)\|([^{}|]+)\}/g;
const ROLES = ['original', 'translation', 'romanization', 'alternative', 'former'];
// A translation's standing (migration 052): official (the holding institution's, a publisher's — cite it), common (in
// use: literature, Wikidata — the default, not stored), own (yours; shown in [brackets] by convention).
const STATUSES = ['official', 'common', 'own'];
const LANG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-(?:[A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/;

const plain = (s) => String(s ?? '').replace(GROUP, '$1');
const reading = (s) => String(s ?? '').replace(GROUP, '$2');
const hasRuby = (s) => new RegExp(GROUP.source).test(String(s ?? ''));
// null when fine, else a message: braces must form {base|reading} groups
function rubyError(s) {
  const rest = String(s ?? '').replace(GROUP, '');
  return /[{}]/.test(rest) ? 'furigana must be written as {kanji|reading}, e.g. {神奈川|かながわ}' : null;
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
function rubyHtml(s) {
  if (!hasRuby(s)) return null;
  let out = '';
  let last = 0;
  for (const m of String(s).matchAll(GROUP)) {
    out += esc(s.slice(last, m.index)) + `<ruby>${esc(m[1])}<rp>(</rp><rt>${esc(m[2])}</rt><rp>)</rp></ruby>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}

function normLang(tag) {
  const t = String(tag ?? '').trim().replace(/_/g, '-');
  if (!t) return null;
  return t.split('-').map((p, i) => (i === 0 ? p.toLowerCase() : p.length === 4 && /^[a-z]+$/i.test(p)
    ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p.length === 2 ? p.toUpperCase() : p.toLowerCase())).join('-');
}
const langOk = (tag) => LANG.test(tag);

// One stored name {text, lang?, role, status?, period?, period_label?, note?} ← a doc value: a string (an alternative
// name) or a mapping; its period as written ("until 1945" — as `period`, or as `period_label` beside the stored range).
// Throws on errors.
function normName(v) {
  if (typeof v === 'string') v = { text: v };
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('each name must be text or {text, lang, role}');
  const extra = Object.keys(v).filter((k) => !['text', 'lang', 'role', 'status', 'period', 'period_label', 'note'].includes(k));
  if (extra.length) throw new Error(`unknown key(s) ${extra.join(', ')}`);
  const text = String(v.text ?? '').trim();
  if (!text) throw new Error('a name needs a text');
  const err = rubyError(text);
  if (err) throw new Error(`"${text}": ${err}`);
  const lang = normLang(v.lang);
  if (lang && !langOk(lang)) throw new Error(`"${v.lang}" is not a language code (e.g. en, ja, ja-Latn, zh-Latn-pinyin)`);
  // "translation, own" — the role with a translation's status after a comma (form lines)
  const [roleText, statusText] = String(v.role ?? '').split(',').map((x) => x.trim().toLowerCase());
  const role = roleText || 'alternative';
  if (!ROLES.includes(role)) throw new Error(`role "${v.role}": one of ${ROLES.join(', ')}`);
  const status = String(v.status ?? statusText ?? '').trim().toLowerCase() || null;
  if (status && !STATUSES.includes(status)) throw new Error(`"${status}": a translation is official, common or own`);
  if (status && role !== 'translation') throw new Error(`"${text}": only a translation is official, common or own`);
  const out = lang ? { text, lang, role } : { text, role };
  if (status && status !== 'common') out.status = status;  // common is the default
  const written = String(v.period_label ?? (/^[[(]/.test(String(v.period ?? '')) ? '' : v.period ?? '')).trim();
  if (written) {
    let parsed;
    try { parsed = parseFuzzyDate(written, { openEnd: true }); } catch (err) { throw new Error(`"${text}": period — ${err.message}`); }
    out.period = parsed.range;
    out.period_label = written;
  } else if (v.period) throw new Error(`"${text}": a period needs its label (e.g. "until 1945")`);
  const note = String(v.note ?? '').trim();
  if (note) out.note = note;
  return out;
}

// Form lines "text | lang | role" ↔ names.
// Lines are split at " | ", so a reading's own "|" (inside braces) must not count: split outside {…} only.
function splitLine(line) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of line) {
    if (ch === '{') depth += 1;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}
function linesToNames(text) {
  return String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [t, lang, role, period, ...note] = splitLine(line);
    return normName({ text: t, lang: lang || null, role: role || null, period: period || null, note: note.join(' | ') || null });
  });
}
// the columns a name needs: trailing empty ones left out ("Hokusai", "Kanagawa | ja | original")
const namesToLines = (names) => (names || []).map((n) => {
  const cols = [n.text, n.lang || '', n.role !== 'alternative' || n.status ? `${n.role}${n.status && n.status !== 'common' ? `, ${n.status}` : ''}` : '',
    n.period_label || '', n.note || ''];
  while (cols.length > 1 && cols[cols.length - 1] === '') cols.pop();
  return cols.join(' | ');
}).join('\n');

module.exports = { ROLES, STATUSES, plain, reading, hasRuby, rubyError, rubyHtml, normLang, langOk, normName, linesToNames,
  namesToLines, splitLine };
