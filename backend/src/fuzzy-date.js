// Fuzzy historical dates as written in content/ YAML → Postgres daterange literal + display label.
//
//   1853            year                 [1853-01-01,1854-01-01)   "1853"
//   -500            year BCE             [0500-01-01 BC,0499-01-01 BC)   "500 BCE"
//   1888-02         month                [1888-02-01,1888-03-01)   "February 1888"
//   1853-03-30      day                  [1853-03-30,1853-03-31)   "30 March 1853"
//   1886-03/1888-02-20   range, both ends inclusive at their own precision   "March 1886–20 February 1888", "20 May–29 July 1890"
//   1478/1482       range of years       [1478-01-01,1483-01-01)   "1478–1482"  (write "c. 1480" as the label)
//
// There is no year 0: 1 BCE is followed by 1 CE, as in Postgres.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const POINT = /^(-?\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function parsePoint(text) {
  const m = POINT.exec(text);
  if (!m) throw new Error(`bad date "${text}" (expected YYYY, YYYY-MM, YYYY-MM-DD, or A/B)`);
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

// → { range: '[1886-03-01,1888-02-21)', label: 'March 1886–20 February 1888' }, or null for null/undefined.
function parseFuzzyDate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const parts = text.split('/');
  if (parts.length > 2) throw new Error(`bad date "${text}"`);
  const from = parsePoint(parts[0]);
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

module.exports = { parseFuzzyDate };
