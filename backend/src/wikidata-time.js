// Wikidata time values → our fuzzy-date text (src/fuzzy-date.js) + display label.
//
// A Wikidata time is { time: '+1853-03-30T00:00:00Z', precision: 11, calendarmodel: '…Q1985727' }:
//   precision 11 day · 10 month · 9 year · 8 decade · 7 century (coarser ones are too vague to use)
//   calendarmodel Q1985727 = Gregorian, Q1985786 = Julian (dates before 1582, and later in some countries)
// Qualifiers can make it fuzzy: P1480 "sourcing circumstances" = Q5727902 "circa", P1319 earliest / P1326 latest date.
const { parseFuzzyDate } = require('./fuzzy-date');

const JULIAN = 'http://www.wikidata.org/entity/Q1985786';
const CIRCA = 'Q5727902';

// Julian calendar date → Gregorian (via the Julian Day Number), for day-precise dates.
function julianToGregorian(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - 32083;
  // JDN → Gregorian (Fliegel–Van Flandern)
  let l = jdn + 68569;
  const n = Math.floor((4 * l) / 146097);
  l -= Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l + 1)) / 1461001);
  l = l - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l) / 2447);
  const day = l - Math.floor((2447 * j) / 80);
  l = Math.floor(j / 11);
  return { y: 100 * (n - 49) + i + l, m: j + 2 - 12 * l, d: day };
}

const pad = (n) => String(n).padStart(2, '0');
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;

// One time value → { value: '1853-03-30', label: null | '1880s' | '19th century' } or null (unusable).
function fromTime(tv) {
  if (!tv || typeof tv.time !== 'string') return null;
  const m = /^([+-])(\d+)-(\d\d)-(\d\d)T/.exec(tv.time);
  if (!m) return null;
  let y = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  let mo = Number(m[3]);
  let d = Number(m[4]);
  const p = tv.precision;
  if (y === 0) return null;
  if (p >= 11 && tv.calendarmodel === JULIAN && y > 0) ({ y, m: mo, d } = julianToGregorian(y, mo, d));
  if (y < 0) return p >= 9 ? { value: String(y), label: null } : null;  // BCE: year precision only (our parser)
  if (p >= 11 && mo && d) return { value: `${y}-${pad(mo)}-${pad(d)}`, label: null };
  if (p === 10 && mo) return { value: `${y}-${pad(mo)}`, label: null };
  if (p >= 9) return { value: String(y), label: null };
  if (p === 8) { const s = y - (y % 10); return { value: `${s}/${s + 9}`, label: `${s}s` }; }
  if (p === 7) { const c = Math.floor((y - 1) / 100) + 1; return { value: `${(c - 1) * 100 + 1}/${c * 100}`, label: `${ordinal(c)} century` }; }
  return null;
}

const qualifierValues = (stmt, prop) => ((stmt && stmt.qualifiers && stmt.qualifiers[prop]) || [])
  .map((q) => q.datavalue && q.datavalue.value).filter(Boolean);

// A statement's time (main value + fuzziness qualifiers) → { value, label } or null.
function fromStatement(stmt) {
  const main = fromTime(stmt.mainsnak && stmt.mainsnak.datavalue && stmt.mainsnak.datavalue.value);
  const earliest = fromTime(qualifierValues(stmt, 'P1319')[0]);
  const latest = fromTime(qualifierValues(stmt, 'P1326')[0]);
  const circa = qualifierValues(stmt, 'P1480').some((v) => v.id === CIRCA);
  const label = (x) => (x.label || parseFuzzyDate(x.value, { openEnd: true }).label);
  if (earliest && latest) {
    const value = `${earliest.value.split('/')[0]}/${latest.value.split('/').pop()}`;
    return { value, label: main ? `c. ${label(main)}` : null };
  }
  if (!main) return null;
  // circa on a year: the same "c. 1755" as typed in the admin (± CIRCA_YEARS, src/fuzzy-date.js); finer precisions
  // keep their own range and just get the label
  if (circa && /^-?\d{1,4}$/.test(main.value)) {
    const y = Number(main.value);
    return { value: y < 0 ? `c. ${-y} BCE` : `c. ${y}`, label: null };
  }
  return circa ? { value: main.value, label: `c. ${label(main)}` } : main;
}

// Start/end qualifiers (P580/P582) of a statement → a period { value, label } (or null). Only a start: "from …".
function periodOf(stmt) {
  const start = fromTime(qualifierValues(stmt, 'P580')[0]);
  const end = fromTime(qualifierValues(stmt, 'P582')[0]);
  if (start && end) return { value: `${start.value.split('/')[0]}/${end.value.split('/').pop()}`, label: null };
  if (start) return { value: start.value, label: `from ${start.label || parseFuzzyDate(start.value).label}` };
  if (end) return { value: end.value, label: `until ${end.label || parseFuzzyDate(end.value).label}` };
  return null;
}

module.exports = { fromTime, fromStatement, periodOf, julianToGregorian };
