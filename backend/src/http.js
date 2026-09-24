const { parseFuzzyDate } = require('./fuzzy-date');

// Small helpers for query-string validation. Throwing an HttpError from a route → JSON error response (see app.js).
class HttpError extends Error {
  constructor(status, error, message) {
    super(message || error);
    this.status = status;
    this.error = error;
  }
}

const badRequest = (message) => new HttpError(400, 'bad_request', message);
const notFound = (message = 'not found') => new HttpError(404, 'not_found', message);

// Integer query parameter within [min, max]; undefined → fallback.
function intParam(query, name, { min, max, fallback = null } = {}) {
  const raw = query[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^-?\d+$/.test(raw)) throw badRequest(`${name} must be an integer`);
  const n = Number(raw);
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
    throw badRequest(`${name} must be between ${min} and ${max}`);
  }
  return n;
}

// ?from=1850&to=1890 → [from, to] years (either may be null). Year 0 does not exist.
function yearWindow(query) {
  const from = intParam(query, 'from', { min: -5000, max: 2100 });
  const to = intParam(query, 'to', { min: -5000, max: 2100 });
  if (from === 0 || to === 0) throw badRequest('there is no year 0 (use -1 for 1 BCE)');
  if (from !== null && to !== null && from > to) throw badRequest('from must not be after to');
  return [from, to];
}

// ?from=1850&to=1890 → daterange literal '[1850-01-01,1891-01-01)' for `period && $n::daterange`; open ends allowed.
// null when neither is given (no filter).
function yearWindowRange(query) {
  const [from, to] = yearWindow(query);
  if (from === null && to === null) return null;
  const lo = from === null ? '' : parseFuzzyDate(from).range.slice(1).split(',')[0];
  const hi = to === null ? '' : parseFuzzyDate(to).range.split(',')[1].slice(0, -1);
  return `[${lo},${hi})`;
}

// Comma-separated list, each item must match the pattern.
function listParam(query, name, pattern = /^[a-z_]+$/) {
  const raw = query[name];
  if (raw === undefined || raw === '') return null;
  const items = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.every((s) => pattern.test(s))) throw badRequest(`${name}: invalid value`);
  return items;
}

module.exports = { HttpError, badRequest, notFound, intParam, yearWindow, yearWindowRange, listParam };
