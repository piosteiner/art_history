// Fuzzy historical dates as written in content/ YAML → Postgres daterange literal + display label.
//
//   1853            year                 [1853-01-01,1854-01-01)   "1853"
//   -500            year BCE             [0500-01-01 BC,0499-01-01 BC)   "500 BCE"
//   1888-02         month                [1888-02-01,1888-03-01)   "February 1888"
//   1853-03-30      day                  [1853-03-30,1853-03-31)   "30 March 1853"
//   1886-03/1888-02-20   range, both ends inclusive at their own precision   "March 1886–20 February 1888", "20 May–29 July 1890"
//   1478/1482       range of years       [1478-01-01,1483-01-01)   "1478–1482"  (write "c. 1480" as the label)
//   1808/           open end (ongoing)   [1808-01-01,)             "since 1808"  — only with { openEnd: true }
//   26 March 1952 · March 1952          written out: the same as 1952-03-26 · 1952-03 (the labels parse back)
//   1952-03-26 or later                 [1952-03-26,)  "26 March 1952 or later" — a moment known only from below:
//                                       also "not before …", "at the earliest …" (provenance: "frühestens ab")
//   1904-10-28 or earlier               (,1904-10-29)  "28 October 1904 or earlier" — known only from above:
//                                       also "by …", "at the latest …" ("spätestens"; "mindestens bis" is "or later")
//   after 1952 · before 1928            [1953-01-01,) · (,1928-01-01)  the named date itself excluded
//
// Written out (case-insensitive), for dates known only roughly — the label is the text itself:
//   13th century                 1201–1300 (the strict count, as Wikidata: the 1st century is 1–100)
//   early / mid / late 13th c.   first / middle / last third: 1201–1233, 1234–1266, 1267–1300
//   first half of the 13th century · second half of the 13th century      1201–1250 · 1251–1300
//   13th–14th century            1201–1400          5th century BCE        500–401 BCE
//   1880s                        1880–1889 (decades; "1200s" is ambiguous — write "13th century" or 1200/1299)
//   c. 1755 · ca. 1755 · circa 1755        1750–1760: ± CIRCA_YEARS (5) — the owner's convention (2026-10-05)
//   c. 1755–1760 · c. 500 BCE              1750–1765 · 505–495 BCE
//
// There is no year 0: 1 BCE is followed by 1 CE, as in Postgres.
// formatFuzzyDate() goes the other way (stored daterange → the text above), for the admin form and the export.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const POINT = /^(-?\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function parsePoint(text) {
  const m = POINT.exec(text);
  if (!m) throw new Error(`bad date "${text}" (expected YYYY, YYYY-MM, YYYY-MM-DD, A/B, or e.g. "c. 1755", "13th century", "late 13th century", "1880s")`);
  const [y, mo, d] = [Number(m[1]), m[2] && Number(m[2]), m[3] && Number(m[3])];
  if (y === 0) throw new Error(`bad date "${text}": there is no year 0 (use -1 for 1 BCE)`);
  if (mo !== undefined && (mo < 1 || mo > 12)) throw new Error(`bad month in "${text}"`);
  if (d !== undefined && (d < 1 || d > daysIn(y, mo))) throw new Error(`bad day in "${text}"`);
  if (y < 0 && mo !== undefined) throw new Error(`"${text}": BCE dates are year-precision only`);
  return { y, mo, d };
}

// Proleptic Gregorian, like Postgres (CE only; BCE is year-precision).
const daysIn = (y, mo) => new Date(Date.UTC(2000, mo, 0)).getUTCDate() - (mo === 2 && !isLeap(y) ? 1 : 0);
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

const nextYear = (y) => (y === -1 ? 1 : y + 1);

// First day covered by the point, and the first day after it (exclusive upper bound).
function start({ y, mo, d }) {
  return { y, mo: mo ?? 1, d: d ?? 1 };
}
function after({ y, mo, d }) {
  if (mo === undefined) return { y: nextYear(y), mo: 1, d: 1 };
  if (d === undefined) return mo === 12 ? { y: nextYear(y), mo: 1, d: 1 } : { y, mo: mo + 1, d: 1 };
  if (d < daysIn(y, mo)) return { y, mo, d: d + 1 };
  return mo === 12 ? { y: nextYear(y), mo: 1, d: 1 } : { y, mo: mo + 1, d: 1 };
}

const pad = (n, w) => String(n).padStart(w, '0');
const pgDate = ({ y, mo, d }) => `${pad(Math.abs(y), 4)}-${pad(mo, 2)}-${pad(d, 2)}${y < 0 ? ' BC' : ''}`;

function pointLabel({ y, mo, d }, withYear = true) {
  const year = withYear ? ` ${y < 0 ? `${-y} BCE` : y}` : '';
  if (mo === undefined) return year.trim();
  return d === undefined ? `${MONTHS[mo - 1]}${year}` : `${d} ${MONTHS[mo - 1]}${year}`;
}

// "20 May–29 July 1890" rather than "20 May 1890–29 July 1890" when both ends share a year.
function rangeLabel(from, to) {
  const sameYear = from.y === to.y && from.mo !== undefined && to.mo !== undefined;
  return `${pointLabel(from, !sameYear)}–${pointLabel(to)}`;
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const CENTURY = /^(?:(early|mid|late|first half of(?: the)?|second half of(?: the)?)\s+)?(\d{1,2})(?:st|nd|rd|th)(?:\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th))?\s+(?:century|c\.?)(?:\s+(bce|bc|ce|ad))?$/i;
const DECADE = /^(\d{2,3}0)s$/;
// "c. 1755" covers this many years on either side. One place to change it (stored ranges keep their old width).
const CIRCA_YEARS = 5;
const CIRCA = /^(?:circa|ca\.?|c\.)\s*(\d{1,4})(?:\s*(?:[-–\/]|to)\s*(\d{1,4}))?(?:\s+(bce|bc|ce|ad))?$/i;
// n years later (or earlier, n < 0) — skipping the year 0, which doesn't exist
function shiftYear(y, n) {
  let r = y + n;
  if (y > 0 && r <= 0) r -= 1;
  if (y < 0 && r >= 0) r += 1;
  return r;
}

// Written-out forms → { from, to (years, signed), label } or null when the text isn't one.
function parseWords(text) {
  const cm = CIRCA.exec(text.replace(/\s+/g, ' ').trim());
  if (cm) {
    const bce = cm[3] && /^bc/i.test(cm[3]);
    const [a, b] = [Number(cm[1]), Number(cm[2] || cm[1])].map((y) => (bce ? -y : y));
    if (!a || !b) throw new Error(`bad date "${text}": there is no year 0`);
    const [lo, hi] = bce ? [Math.min(a, b), Math.max(a, b)] : [a, b];
    if (hi < lo) throw new Error(`bad date "${text}": end is before start`);
    const era = bce ? ' BCE' : '';
    const label = cm[2] ? `c. ${Number(cm[1])}–${Number(cm[2])}${era}` : `c. ${Number(cm[1])}${era}`;
    return { from: shiftYear(lo, -CIRCA_YEARS), to: shiftYear(hi, CIRCA_YEARS), label };
  }
  const dm = DECADE.exec(text);
  if (dm) {
    const y = Number(dm[1]);
    if (y % 100 === 0) throw new Error(`"${text}" is ambiguous: write "${ordinal(y / 100 + 1)} century" or ${y}/${y + 99}`);
    return { from: y, to: y + 9, label: text };
  }
  const m = CENTURY.exec(text.replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const part = m[1] ? m[1].toLowerCase().replace(/ of$/, ' of the') : null;
  const [c1, c2] = [Number(m[2]), Number(m[3] || m[2])];
  const bce = m[4] && /^bc/i.test(m[4]);
  if (c1 < 1 || c2 < c1 || (bce && m[3])) throw new Error(`bad century "${text}"${bce && m[3] ? ' (write BCE ranges as years, e.g. -500/-301)' : ''}`);
  if (part && m[3]) throw new Error(`bad century "${text}": early/mid/late only with a single century`);
  // signed first and last year of a century: 13th = 1201..1300; 5th BCE = -500..-401
  const span = (c) => (bce ? [-c * 100, -(c - 1) * 100 - 1] : [(c - 1) * 100 + 1, c * 100]);
  let [from] = span(c1);
  let [, to] = span(c2);
  if (part) {
    const cut = { early: [0, 32], mid: [33, 65], late: [66, 99], 'first half of the': [0, 49], 'second half of the': [50, 99] }[part];
    // offsets within the 100 years (no year 0 inside a century, so plain addition works on both sides of it)
    [from, to] = [from + cut[0], from + cut[1]];
  }
  const label = `${part ? `${part} ` : ''}${ordinal(c1)}${m[3] ? `–${ordinal(c2)}` : ''} century${bce ? ' BCE' : ''}`;
  return { from, to, label };
}

// "26 March 1952", "March 1952" → "1952-03-26", "1952-03" (else the text as it is)
function isoOf(text) {
  const m = /^(?:(\d{1,2})\s+)?([A-Za-z]+)\s+(\d{1,4})$/.exec(text.trim());
  const mo = m ? MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()) + 1 : 0;
  if (!m || !mo) return text.trim();
  return `${m[3]}-${pad(mo, 2)}${m[1] ? `-${pad(Number(m[1]), 2)}` : ''}`;
}
// inclusive: "1952-03-26 or later", "not before …", "at the earliest …" · "… or earlier", "by …", "at the latest …"
const LATER = /^(?:not before|at the earliest)\s+(.+)$|^(.+?)\s+or later$/i;
const EARLIER = /^(?:by|at the latest)\s+(.+)$|^(.+?)\s+or earlier$/i;
// exclusive: "after 1952" = from 1953 on, "before 1928" = up to 1927
const AFTER = /^after\s+(.+)$/i;
const BEFORE = /^before\s+(.+)$/i;

// → { range: '[1886-03-01,1888-02-21)', label: 'March 1886–20 February 1888' }, or null for null/undefined.
// openEnd allows "1808/" (still ongoing: upper bound infinite) — for periods, not for births or creation dates.
// Forms as provenance sources write them (Kunsthaus Zürich …), rewritten to the ones below (077):
//   "between 1917 and 1930" → 1917/1930 · "13.VI.1913" (Roman month) and "1.7.1949" → 1913-06-13, 1949-07-01 ·
//   "7.1934" → 1934-07
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
function normalizeSourceForms(text) {
  let t = text.replace(/^between\s+(.+?)\s+and\s+(.+)$/i, '$1/$2');
  t = t.replace(/(^|[^\d.])(\d{1,2})\.([IVX]{1,4}|\d{1,2})\.(\d{3,4})(?![\d.])/g, (m, pre, d, mo, y) => {
    const month = ROMAN[mo] || Number(mo);
    return month >= 1 && month <= 12 ? `${pre}${y}-${pad(month, 2)}-${pad(Number(d), 2)}` : m;
  });
  t = t.replace(/(^|[^\d.])(\d{1,2})\.(\d{4})(?![\d.])/g, (m, pre, mo, y) => (Number(mo) >= 1 && Number(mo) <= 12 ? `${pre}${y}-${pad(Number(mo), 2)}` : m));
  return t;
}

function parseFuzzyDate(value, { openEnd = false } = {}) {
  if (value === null || value === undefined) return null;
  try {
    return parseOne(value, { openEnd });
  } catch (err) {
    // not one of the forms above (an invalid one keeps its message: end before start, year 0, "1200s", "1/2/3" …):
    // perhaps two of them as a range, the way people write it (099)
    if (!/\(expected YYYY|only allowed for periods/.test(err.message)) throw err;
    const range = parseRange(String(value).replace(/\s+/g, ' ').trim(), { openEnd });
    if (range) return range;
    throw err;
  }
}

// Ranges as written, each end any of the forms above (only for texts the forms above don't take — every date that
// parsed before parses as before):
//   1900-1905 · 1900–1905 · 1900 - 1905 · 1900 to 1905     [1900-01-01,1906-01-01)   "1900–1905"
//   c. 1900–c. 1905 · March 1900 – May 1905 · 1880s–1890s · 12 March 1900–1905 · c. 965/1397
//   1900– · from 1900 · since 1900 · c. 965/                  open end, only with { openEnd: true }   "since 1900"
//   –1905 · until 1905 · till 1905                            known only from above                   "until 1905"
//   500 BCE · 500 BCE–400 BCE                                 as the labels write it: -500 · -500/-400
// "1900-05" stays May 1900 (YYYY-MM), as before.
const SEPARATORS = [' / ', '/', ' – ', ' — ', ' - ', '–', '—', ' to ', ' until ', '-'];
function parseRange(text, { openEnd }) {
  if (/\bBCE?\b/i.test(text) && !/[-–—\/]|\sto\s/.test(text)) return parseSide(text);  // "500 BCE" alone
  const from = /^(?:from|since)\s+(.+)$/i.exec(text);
  if (from) return openRange(parseSide(from[1]), openEnd, text);
  const until = /^(?:until|till|up to)\s+(.+)$/i.exec(text);
  if (until) { const p = parseSide(until[1]); return p && { range: `(,${p.range.split(',')[1]}`, label: `until ${p.label}` }; }
  for (const sep of SEPARATORS) {
    for (let at = text.indexOf(sep); at >= 0; at = text.indexOf(sep, at + 1)) {
      const b = text.slice(at + sep.length).trim();
      const a = borrowFromEnd(text.slice(0, at).trim(), b);
      if (sep === '-' && /^\d{2}(?:-\d{2})?$/.test(b)) continue;  // 1900-05: a month, not a range
      if (!a && (!b || sep === '/' || sep === ' / ' || sep === '-')) continue;  // an open start is "–1808"; "-500" is a year BCE, "/1808" an error
      const left = a ? parseSide(a) : null;
      const right = b ? parseSide(b) : null;
      if ((a && !left) || (b && !right)) continue;
      if (!b) return openRange(left, openEnd, text);
      if (!a) return { range: `(,${right.range.split(',')[1]}`, label: `until ${right.label}` };
      const lo = left.range.split(',')[0];
      const hi = right.range.split(',')[1];
      if (!lo.startsWith('(') && hi !== ')' && compareBounds(lo.slice(1), hi.slice(0, -1)) >= 0) {
        throw new Error(`bad date "${text}": end is before start`);
      }
      return { range: `${lo},${hi}`, label: joinLabels(left.label, right.label) };
    }
  }
  return null;
}
// A start that leaves out what it shares with the end, as people write ranges: "15–31 March 1901", "May–October
// 1909", "20 May–29 July 1890" — the start takes the end's month and year, or its year. (Without this, "15" was read
// as the year 15.) Only a bare day before a day, month and year, or a month (with or without its day) before a
// month and year; anything else is left as it is.
function borrowFromEnd(a, b) {
  const end = /^(?:(\d{1,2})\s+)?([A-Za-z]+)\s+(\d{1,4})$/.exec(b);
  if (!end || !MONTHS.includes(end[2])) return a;
  if (/^\d{1,2}$/.test(a) && end[1]) return `${a} ${end[2]} ${end[3]}`;
  const start = /^(?:\d{1,2}\s+)?([A-Za-z]+)$/.exec(a);
  if (start && MONTHS.includes(start[1])) return `${a} ${end[3]}`;
  return a;
}
function parseSide(text) {
  for (const t of [text, text.replace(/\b(\d{1,4})\s*(?:BCE|BC)\b/gi, '-$1')]) {  // "500 BCE", as the labels write it
    try { return parseOne(t, { openEnd: false }); } catch { /* the next form */ }
  }
  return null;
}
function openRange(p, openEnd, text) {
  if (!p) return null;
  if (!openEnd) throw new Error(`bad date "${text}": an open end ("…/") is only allowed for periods`);
  return { range: `${p.range.split(',')[0]},)`, label: `since ${p.label}` };
}
// "20 May 1890" + "29 July 1890" → "20 May–29 July 1890"; "15 March 1901" + "31 March 1901" → "15–31 March 1901";
// otherwise both as they are
function joinLabels(a, b) {
  const ya = /^(.*[A-Za-z]) (\d{1,4})$/.exec(a);
  const yb = /^(.*[A-Za-z]) (\d{1,4})$/.exec(b);
  const month = (x) => MONTHS.some((m) => x.includes(m));
  if (ya && yb && ya[2] === yb[2] && month(ya[1]) && month(yb[1])) {
    const da = /^(\d{1,2}) ([A-Za-z]+)$/.exec(ya[1]);
    const db = /^(\d{1,2}) ([A-Za-z]+)$/.exec(yb[1]);
    if (da && db && da[2] === db[2]) return `${da[1]}–${b}`;
    return `${ya[1]}–${b}`;
  }
  return `${a}–${b}`;
}
const compareBounds = (a, b) => {
  const [x, y] = [parseBound(a), parseBound(b)];
  return x.y - y.y || x.mo - y.mo || x.d - y.d;
};

function parseOne(value, { openEnd = false } = {}) {
  const raw = normalizeSourceForms(String(value).trim());
  // a moment known only from one side (provenance: "at the earliest from", "at least until"): an open range
  const later = LATER.exec(raw);
  if (later) {
    const p = parseFuzzyDate(later[1] || later[2]);
    return { range: `${p.range.split(',')[0]},)`, label: `${p.label} or later` };
  }
  const earlier = EARLIER.exec(raw);
  if (earlier) {
    const p = parseFuzzyDate(earlier[1] || earlier[2]);
    return { range: `(,${p.range.split(',')[1]}`, label: `${p.label} or earlier` };
  }
  const afterIt = AFTER.exec(raw);
  if (afterIt) {
    const p = parseFuzzyDate(afterIt[1]);
    return { range: `[${p.range.split(',')[1].replace(')', '')},)`, label: `after ${p.label}` };
  }
  const beforeIt = BEFORE.exec(raw);
  if (beforeIt) {
    const p = parseFuzzyDate(beforeIt[1]);
    return { range: `(,${p.range.split(',')[0].replace('[', '')})`, label: `before ${p.label}` };
  }
  const text = raw.split('/').map(isoOf).join('/');
  const words = parseWords(text);
  if (words) return { range: `[${pgDate(start({ y: words.from }))},${pgDate(after({ y: words.to }))})`, label: words.label };
  const parts = text.split('/');
  if (parts.length > 2) throw new Error(`bad date "${text}"`);
  const from = parsePoint(parts[0]);
  if (parts.length === 2 && parts[1] === '') {
    if (!openEnd) throw new Error(`bad date "${text}": an open end ("…/") is only allowed for periods`);
    return { range: `[${pgDate(start(from))},)`, label: `since ${pointLabel(from)}` };
  }
  const to = parts.length === 2 ? parsePoint(parts[1]) : from;
  const lo = start(from);
  const hi = after(to);
  const cmp = (a, b) => a.y - b.y || a.mo - b.mo || a.d - b.d;
  if (cmp(lo, hi) >= 0) throw new Error(`bad date "${text}": end is before start`);
  return {
    range: `[${pgDate(lo)},${pgDate(hi)})`,
    label: parts.length === 2 ? rangeLabel(from, to) : pointLabel(from),
  };
}

// Postgres daterange text → the shortest fuzzy-date text that parses back to exactly the same range.
//   '[1886-03-01,1888-02-21)' → '1886-03/1888-02-20'   '["0500-01-01 BC","0499-01-01 BC")' → '-500'
//   '[1808-01-01,)' → '1808/'   null → null
// Each end is written as coarsely as its bound allows, except a whole-year start before a month/day end is
// written as a month ("1886-01/1886-02", not "1886/1886-02") — same range, closer to what was meant.
// { coarseStart: true } skips that exception ("1901/1903-05-08"); dateToDoc() picks whichever matches the label.
const YEAR = 0, MONTH = 1, DAY = 2;
const prevYear = (y) => (y === 1 ? -1 : y - 1);

function parseBound(text) {
  const m = /^"?(\d{4,})-(\d{2})-(\d{2})( BC)?"?$/.exec(text);
  if (!m) throw new Error(`unsupported range bound "${text}"`);
  const y = Number(m[1]);
  return { y: m[4] ? -y : y, mo: Number(m[2]), d: Number(m[3]) };
}

function dayBefore({ y, mo, d }) {
  if (d > 1) return { y, mo, d: d - 1 };
  if (mo > 1) return { y, mo: mo - 1, d: daysIn(y, mo - 1) };
  return { y: prevYear(y), mo: 12, d: 31 };
}

function pointText(p, precision) {
  if (precision === YEAR) return String(p.y);
  const ym = `${p.y}-${pad(p.mo, 2)}`;
  return precision === MONTH ? ym : `${ym}-${pad(p.d, 2)}`;
}

function formatFuzzyDate(range, { coarseStart = false } = {}) {
  if (range === null || range === undefined) return null;
  // known only from above: "… or earlier" (the day before the exclusive upper bound)
  const below = /^\(,([^,]+)\)$/.exec(String(range));
  if (below) return `${pointText(dayBefore(parseBound(below[1])), DAY)} or earlier`;
  const m = /^\[([^,]+),([^,]*)\)$/.exec(String(range));
  if (!m) throw new Error(`unsupported daterange "${range}"`);
  const lo = parseBound(m[1]);
  const coarsest = lo.mo === 1 && lo.d === 1 ? YEAR : lo.d === 1 ? MONTH : DAY;
  if (m[2] === '') return `${pointText(lo, coarsest)}/`;

  const hi = parseBound(m[2]);
  // A single day is that day, also the last of a month or a year: [1869-12-31,1870-01-01) is "1869-12-31", not
  // "1869-12-31/1869-12" — the end alone would be written as coarsely as its bound allows (below)
  if (coarsest === DAY && pointText(dayBefore(hi), DAY) === pointText(lo, DAY)) return pointText(lo, DAY);
  // The end is written as coarsely as its bound allows — but not coarser than the start: [1926-12-01,1927-01-01) is
  // "1926-12" (December), not "1926-12/1926", although 1927-01-01 is also a year boundary.
  let endPrecision = hi.mo === 1 && hi.d === 1 ? YEAR : hi.d === 1 ? MONTH : DAY;
  if (coarsest > endPrecision) endPrecision = Math.min(coarsest, hi.d === 1 ? MONTH : DAY);
  const end = endPrecision === YEAR ? { y: prevYear(hi.y), mo: 12, d: 31 } : dayBefore(hi);
  const startPrecision = coarsest === YEAR && endPrecision !== YEAR && !coarseStart ? MONTH : coarsest;

  const endText = pointText(end, endPrecision);
  // Exactly one unit (a year, a month, or a day that happens to be the 1st) → a single value.
  if (coarsest <= endPrecision && pointText(lo, endPrecision) === endText) return endText;
  return `${pointText(lo, startPrecision)}/${endText}`;
}

module.exports = { parseFuzzyDate, formatFuzzyDate, CIRCA_YEARS };
