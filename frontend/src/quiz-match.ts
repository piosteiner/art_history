// How close a typed answer is (the picture quiz, views/quiz.ts): folded like the searches (fold.ts — accents, ß, ’),
// punctuation and a leading article dropped, then the better of letters (edit distance: typos) and words (in any
// order, small words like "in the" not counted: "Daibutsu in the Todaiji" = "Tōdai-ji Daibutsu"). A hyphen both
// joins and parts (Tōdai-ji = todaiji = todai ji). 1 = the same, 0 = nothing alike.
import { fold } from './fold';

const ARTICLE = /^(?:the|a|an|la|le|les|l|el|los|las|il|lo|gli|i|der|die|das|den|dem|ein|eine|de|het|een) /;
export const normal = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(ARTICLE, '');

function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

// small words that don't decide a match (English, French, German, Italian, Spanish, Dutch)
const SMALL = new Set(('the a an of in at on to and with from for by la le les l un une des du de d et au aux en der die das den dem des ein eine '
  + 'und im am vom von zu mit il lo gli i e del della di da con el los las y het een van').split(' '));

/** Words of the answer found in the name, as a share of both (Dice) — small words left out, a word with a typo
 *  counts when nearly the same. */
function words(a: string, b: string) {
  const content = (x: string) => {
    const all = x.split(' ').filter(Boolean);
    const big = all.filter((w) => !SMALL.has(w));
    return big.length ? big : all;
  };
  const wa = content(a);
  const wb = content(b);
  if (!wa.length || !wb.length) return 0;
  const near = (x: string, y: string) => x === y || (x.length > 3 && distance(x, y) <= (x.length > 6 ? 2 : 1));
  const found = wa.filter((x) => wb.some((y) => near(x, y))).length;
  return (2 * found) / (wa.length + wb.length);
}

function compare(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(1 - distance(a, b) / Math.max(a.length, b.length), words(a, b));
}

export function similarity(answer: string, name: string) {
  const joined = (s: string) => normal(s.replace(/(\p{L})[-‐‑](?=\p{L})/gu, '$1'));
  return Math.max(compare(normal(answer), normal(name)), compare(joined(answer), joined(name)));
}

/** The best match among a name's forms → {score, name}. */
export function bestMatch(answer: string, names: string[]) {
  let best = { score: 0, name: names[0] ?? '' };
  for (const n of names) {
    const score = similarity(answer, n);
    if (score > best.score) best = { score, name: n };
  }
  return best;
}

/** Points for a match: right (≥ 0.85), nearly (≥ 0.6, half), else none. */
export const points = (score: number) => (score >= 0.85 ? 1 : score >= 0.6 ? 0.5 : 0);

/** A typed year: "1889", "c. 1889", "500 BC", "-500" → a number (BCE negative), or null. */
export function parseYear(s: string): number | null {
  const m = /(-)?\s*(\d{1,4})\s*(bce?|v\.?\s*chr\.?|av\.?\s*j\.?-?c\.?)?/i.exec(s.trim());
  if (!m) return null;
  const y = Number(m[2]);
  return m[1] || m[3] ? -y : y;
}

/** Points for a year: within 5 years of the work's dates 1, within 15 ½, within 30 ¼ — twice that before the year 1000. */
export function yearPoints(year: number, from: number, to: number) {
  const off = year < from ? from - year : year > to ? year - to : 0;
  const k = from < 1000 ? 2 : 1;
  return off <= 5 * k ? 1 : off <= 15 * k ? 0.5 : off <= 30 * k ? 0.25 : 0;
}

/** The rule above, for the page. */
export const YEAR_RULE = 'Years: within 5 years of the work’s dates 1, within 15 ½, within 30 ¼ — twice that before the year 1000.';
