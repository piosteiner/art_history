// Fuzzy historical dates as written in content/ YAML → Postgres daterange literal + display label.
//
//   1853            year                 [1853-01-01,1854-01-01)   "1853"
//   -500            year BCE             [0500-01-01 BC,0499-01-01 BC)   "500 BCE"
//   1888-02         month                [1888-02-01,1888-03-01)   "February 1888"
//   1853-03-30      day                  [1853-03-30,1853-03-31)   "30 March 1853"
//   1886-03/1888-02-20   range, both ends inclusive at their own precision   "March 1886–20 February 1888", "20 May–29 July 1890"
//   1478/1482       range of years       [1478-01-01,1483-01-01)   "1478–1482"  (write "c. 1480" as the label)
//   1808/           open end (ongoing)   [1808-01-01,)             "since 1808"  — only with { openEnd: true }
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

// → { range: '[1886-03-01,1888-02-21)', label: 'March 1886–20 February 1888' }, or null for null/undefined.
// openEnd allows "1808/" (still ongoing: upper bound infinite) — for periods, not for births or creation dates.
function parseFuzzyDate(value, { openEnd = false } = {}) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
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
  const m = /^\[([^,]+),([^,]*)\)$/.exec(String(range));
  if (!m) throw new Error(`unsupported daterange "${range}"`);
  const lo = parseBound(m[1]);
  const coarsest = lo.mo === 1 && lo.d === 1 ? YEAR : lo.d === 1 ? MONTH : DAY;
  if (m[2] === '') return `${pointText(lo, coarsest)}/`;

  const hi = parseBound(m[2]);
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
