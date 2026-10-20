// What a search asks for, read from what was typed: the words every hit must have, phrases, and what to leave out —
//   gauguin -kunsthaus                      without "kunsthaus" anywhere
//   gauguin -"kunsthaus zürich"             without both words
//   "the starry night"                      the words as a phrase
//   gauguin but not in kunsthaus zürich     without the works that are in the Kunsthaus now (their collection)
//   gauguin not in zürich · except … · without … · excluding … · aber nicht in … · nicht in … · ohne … · außer …
// "in" / "at" / "im" / "bei" after the negation means the collection a work is in now: "not in Kunsthaus Zürich" keeps
// the works that were there once. Otherwise the words are left out wherever they appear.
import { fold } from './fold';

export interface Exclusion {
  /** as typed, for the interpretation shown ("not in Kunsthaus Zürich") */
  text: string;
  /** folded words: an entry is left out when it has every one */
  words: string[];
  /** 'collection': an artwork's current collection only; 'any': anywhere in the entry */
  where: 'collection' | 'any';
}

export interface ParsedQuery {
  /** folded words every hit must have (quoted phrases' words included) */
  words: string[];
  /** folded phrases a hit must contain as written */
  phrases: string[];
  not: Exclusion[];
  /** the positive part as typed: for the typo suggestions and the APIs' name search */
  positive: string;
  /** anything beyond plain words (an exclusion, a phrase) — worth showing how the query was read */
  special: boolean;
}

// a negation and what follows it up to the next one; the longest forms first
const NEGATION = /\b(but not|and not|aber nicht|und nicht|except(?:ing)?|excluding|without|not|nicht|ohne|außer|ausser)\b/i;
const COLLECTION = /^(?:in|at|im|in der|in den|bei|beim)\s+/i;
const OTHER_PREP = /^(?:by|from|of|von|vom|aus)\s+/i;
// connecting words of a typed sentence, not search words (only dropped when other words remain)
const FILLER = new Set(['in', 'at', 'by', 'of', 'the', 'and', 'but', 'from', 'im', 'bei', 'von', 'der', 'die', 'das', 'und', 'aber', 'all', 'alle', 'works', 'werke']);

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}'-]+/u).map((w) => w.replace(/^[-']+|[-']+$/g, '')).filter(Boolean);

export function parseQuery(query: string): ParsedQuery {
  let rest = ` ${query} `;
  const not: Exclusion[] = [];
  const phrases: string[] = [];
  // -"a phrase" and "a phrase"
  rest = rest.replace(/(^|\s)-"([^"]+)"/g, (_, sp: string, t: string) => { not.push({ text: t.trim(), words: words(t), where: 'any' }); return sp; });
  rest = rest.replace(/"([^"]+)"/g, (_, t: string) => { phrases.push(fold(t).trim()); return ` ${t} `; });
  // "… but not in X", "… ohne X": the negation and everything after it, up to the next negation
  const parts = rest.split(NEGATION);
  let positive = parts[0];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    let t = parts[i + 1].trim();
    if (!t) continue;
    const where = COLLECTION.test(t) ? 'collection' : 'any';
    t = t.replace(COLLECTION, '').replace(OTHER_PREP, '').trim();
    const w = words(t);
    if (w.length) not.push({ text: t, words: w, where });
  }
  // -word
  positive = positive.replace(/(^|\s)-([^\s"-][^\s"]*)/g, (_, sp: string, t: string) => { not.push({ text: t, words: words(t), where: 'any' }); return sp; });
  const all = words(positive);
  const kept = all.filter((w) => !FILLER.has(w));
  const special = not.length > 0 || phrases.length > 0;
  return {
    words: (special && kept.length ? kept : all),
    phrases,
    not,
    positive: positive.replace(/\s+/g, ' ').trim(),
    special,
  };
}

/** "gauguin · not in: Kunsthaus Zürich · without: copy" — how the query was read. */
export function describeQuery(p: ParsedQuery): string {
  const parts = [p.words.join(' ')];
  for (const n of p.not) parts.push(`${n.where === 'collection' ? 'not in' : 'without'}: ${n.text}`);
  return parts.filter(Boolean).join(' · ');
}

/**
 * The query for the full-text API (web-search syntax): the positive words and phrases, the exclusions that apply
 * anywhere as -"…"; those about the collection go separately (?not_in=) — a work's own texts rarely name its museum.
 */
export function textQuery(p: ParsedQuery): { q: string; notIn: string[] } {
  const quoted = new Set(p.phrases);
  const plain = p.words.filter((w) => ![...quoted].some((ph) => ph.split(' ').includes(w)));
  const q = [...plain, ...p.phrases.map((ph) => `"${ph}"`), ...p.not.filter((n) => n.where === 'any').map((n) => (n.words.length > 1 ? `-"${n.words.join(' ')}"` : `-${n.words[0]}`))].join(' ');
  return { q, notIn: p.not.filter((n) => n.where === 'collection').map((n) => n.words.join(' ')) };
}
