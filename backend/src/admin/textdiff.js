// Word-level diff for long texts (biographies, descriptions, notes) in the history and the revert preview.
// jsdiff's diffWordsWithSpace finds the smallest set of inserted/removed words (Myers' algorithm); unchanged stretches
// are shortened to a few words of context around each change, so a one-word fix in a long biography is visible at once.
const { diffWordsWithSpace, diffArrays } = require('diff');
const { html, raw } = require('./html');

const CONTEXT = 8;      // words of unchanged text kept on each side of a change
const LONG = 80;        // strings at least this long (or any *_md field) get a word diff instead of before/after

const isLongText = (key, a, b) => (typeof a === 'string' || typeof b === 'string')
  && (/_md$/.test(key) || String(a ?? '').length >= LONG || String(b ?? '').length >= LONG);

// Unchanged text: keep the first/last CONTEXT words that touch a change, "…" in between.
function trimmed(text, { head, tail }) {
  const words = text.split(/(\s+)/);  // keeps the whitespace tokens, so joining restores the text
  const n = CONTEXT * 2;              // word + whitespace pairs
  if (words.length <= n * 2 + 2) return html`${text}`;
  const start = head ? words.slice(0, n).join('') : '';
  const end = tail ? words.slice(-n).join('') : '';
  return html`${start}<span class="wd-gap">…</span>${end}`;
}

// Merge change runs split by tiny unchanged bits (a hyphen, a space) into one removed + one added part:
// "~~ten~~decade-~~year~~long" → "~~ten-year~~ decade-long".
function coalesce(parts) {
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    const changed = (x) => x && (x.added || x.removed);
    if (!p.added && !p.removed && p.value.length <= 2 && /^[^\p{L}\p{N}]*$/u.test(p.value) && changed(out[out.length - 1]) && changed(parts[i + 1])) {
      out.push({ removed: true, value: p.value }, { added: true, value: p.value });
      continue;
    }
    out.push(p);
  }
  // Now gather each run of changed parts into one removed and one added part.
  const merged = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if ((p.added || p.removed) && last && last.run) {
      if (p.removed) last.removed += p.value; else last.added += p.value;
    } else if (p.added || p.removed) {
      merged.push({ run: true, removed: p.removed ? p.value : '', added: p.added ? p.value : '' });
    } else {
      merged.push(p);
    }
  }
  return merged.flatMap((p) => (p.run
    ? [p.removed && { removed: true, value: p.removed }, p.added && { added: true, value: p.added }].filter(Boolean)
    : [p]));
}

// → html with <del>/<ins>; both sides null/empty → ''.
function wordDiff(before, after) {
  const parts = coalesce(diffWordsWithSpace(String(before ?? ''), String(after ?? '')));
  return html`<div class="wdiff">${parts.map((p, i) => {
    if (p.removed) return html`<del>${p.value}</del>`;
    if (p.added) return html`<ins>${p.value}</ins>`;
    // Context only toward neighbouring changes: after the previous one (head) and before the next one (tail).
    return trimmed(p.value, { head: i > 0, tail: i < parts.length - 1 });
  })}</div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Three-way merge of texts at word level (the diff3 idea): given the common ancestor `base` and two edited versions,
// apply both sets of edits if they touch different words; null if they overlap (a real conflict).
// Used by revert: base = what the change wrote, ours = the text before it, theirs = the text now — so the merge undoes
// only this change's words and keeps later edits elsewhere in the text.
// ---------------------------------------------------------------------------------------------------------------
const tokens = (s) => String(s ?? '').match(/\s+|[^\s]+/g) || [];

// base tokens → edits as hunks { start, end, insert[] } in base positions (end exclusive; start = end → pure insertion)
function hunks(base, other) {
  const out = [];
  let pos = 0;
  let cur = null;
  for (const part of diffArrays(base, other)) {
    if (!part.added && !part.removed) {
      if (cur) { out.push(cur); cur = null; }
      pos += part.count;
      continue;
    }
    cur = cur || { start: pos, end: pos, insert: [] };
    if (part.removed) { cur.end += part.count; pos += part.count; } else cur.insert.push(...part.value);
  }
  if (cur) out.push(cur);
  return out;
}

const sameHunk = (a, b) => a.start === b.start && a.end === b.end && a.insert.join('') === b.insert.join('');
const overlaps = (a, b) => (a.start < b.end && b.start < a.end)  // replace the same words
  || (a.start === b.start && (a.start === a.end || b.start === b.end))  // insert at the same spot / at a replaced start
  || (a.start === a.end && a.start > b.start && a.start < b.end) || (b.start === b.end && b.start > a.start && b.start < a.end);

function merge3(base, ours, theirs) {
  const b = tokens(base);
  const h1 = hunks(b, tokens(ours));
  const h2 = hunks(b, tokens(theirs)).filter((h) => !h1.some((x) => sameHunk(x, h)));  // identical edit on both sides: once
  if (h1.some((x) => h2.some((y) => overlaps(x, y)))) return null;
  const all = [...h1, ...h2].sort((x, y) => x.start - y.start || (x.end - x.start) - (y.end - y.start));
  const result = [];
  let pos = 0;
  for (const h of all) {
    result.push(...b.slice(pos, h.start), ...h.insert);
    pos = h.end;
  }
  result.push(...b.slice(pos));
  return result.join('');
}

module.exports = { wordDiff, isLongText, merge3, raw };
