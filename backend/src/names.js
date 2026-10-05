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
// Other names (column `names`, jsonb): [{text, lang?, role}], role = original | translation | romanization | alternative.
// In forms one per line: "text | lang | role" — lang and role optional ("Hokusai" alone = an alternative name).
const GROUP = /\{([^{}|]+)\|([^{}|]+)\}/g;
const ROLES = ['original', 'translation', 'romanization', 'alternative'];
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

// One stored name {text, lang?, role} ← a doc value: a string (an alternative name) or a mapping. Throws on errors.
function normName(v) {
  if (typeof v === 'string') v = { text: v };
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('each name must be text or {text, lang, role}');
  const extra = Object.keys(v).filter((k) => !['text', 'lang', 'role'].includes(k));
  if (extra.length) throw new Error(`unknown key(s) ${extra.join(', ')}`);
  const text = String(v.text ?? '').trim();
  if (!text) throw new Error('a name needs a text');
  const err = rubyError(text);
  if (err) throw new Error(`"${text}": ${err}`);
  const lang = normLang(v.lang);
  if (lang && !langOk(lang)) throw new Error(`"${v.lang}" is not a language code (e.g. en, ja, ja-Latn, zh-Latn-pinyin)`);
  const role = v.role ? String(v.role).trim().toLowerCase() : 'alternative';
  if (!ROLES.includes(role)) throw new Error(`role "${v.role}": one of ${ROLES.join(', ')}`);
  return lang ? { text, lang, role } : { text, role };
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
    const [t, lang, role] = splitLine(line);
    return normName({ text: t, lang: lang || null, role: role || null });
  });
}
const namesToLines = (names) => (names || []).map((n) => [n.text, n.lang || (n.role !== 'alternative' ? '' : null), n.role !== 'alternative' ? n.role : null]
  .filter((p) => p !== null).join(' | ')).join('\n');

module.exports = { ROLES, plain, reading, hasRuby, rubyError, rubyHtml, normLang, langOk, normName, linesToNames,
  namesToLines, splitLine };
