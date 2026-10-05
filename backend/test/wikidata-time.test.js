const test = require('node:test');
const assert = require('node:assert/strict');
const { fromTime, fromStatement, periodOf, julianToGregorian } = require('../src/wikidata-time');
const { parseFuzzyDate } = require('../src/fuzzy-date');

const G = 'http://www.wikidata.org/entity/Q1985727';
const J = 'http://www.wikidata.org/entity/Q1985786';
const t = (time, precision, calendarmodel = G) => ({ time, precision, calendarmodel });

test('precisions → fuzzy dates', () => {
  assert.deepEqual(fromTime(t('+1853-03-30T00:00:00Z', 11)), { value: '1853-03-30', label: null });
  assert.deepEqual(fromTime(t('+1879-08-00T00:00:00Z', 10)), { value: '1879-08', label: null });
  assert.deepEqual(fromTime(t('+1889-01-01T00:00:00Z', 9)), { value: '1889', label: null });
  assert.deepEqual(fromTime(t('+1885-00-00T00:00:00Z', 8)), { value: '1880/1889', label: '1880s' });
  assert.deepEqual(fromTime(t('+1850-00-00T00:00:00Z', 7)), { value: '1801/1900', label: '19th century' });
  assert.deepEqual(fromTime(t('+1800-00-00T00:00:00Z', 7)), { value: '1701/1800', label: '18th century' });
  assert.deepEqual(fromTime(t('-0500-00-00T00:00:00Z', 9)), { value: '-500', label: null });
  assert.equal(fromTime(t('+1850-00-00T00:00:00Z', 6)), null);  // millennium: too vague
  for (const x of ['1853-03-30', '1879-08', '1880/1889', '1801/1900', '-500']) assert.ok(parseFuzzyDate(x), x);
});

test('Julian dates are converted to the Gregorian calendar', () => {
  assert.deepEqual(julianToGregorian(1564, 2, 15), { y: 1564, m: 2, d: 25 });  // Galileo's birth
  assert.deepEqual(fromTime(t('+1471-05-21T00:00:00Z', 11, J)), { value: '1471-05-30', label: null });  // Dürer
});

test('circa and earliest/latest qualifiers', () => {
  const circa = { mainsnak: { datavalue: { value: t('+1480-00-00T00:00:00Z', 9) } },
    qualifiers: { P1480: [{ datavalue: { value: { id: 'Q5727902' } } }] } };
  assert.deepEqual(fromStatement(circa), { value: 'c. 1480', label: null });  // ±5 years, as typed in the admin
  const range = { mainsnak: { datavalue: { value: t('+1480-00-00T00:00:00Z', 9) } },
    qualifiers: { P1319: [{ datavalue: { value: t('+1478-00-00T00:00:00Z', 9) } }], P1326: [{ datavalue: { value: t('+1482-00-00T00:00:00Z', 9) } }] } };
  assert.deepEqual(fromStatement(range), { value: '1478/1482', label: 'c. 1480' });
});

test('start/end qualifiers → periods', () => {
  const q = (p, time, prec) => ({ [p]: [{ datavalue: { value: t(time, prec) } }] });
  assert.deepEqual(periodOf({ qualifiers: { ...q('P580', '+1886-03-00T00:00:00Z', 10), ...q('P582', '+1888-02-20T00:00:00Z', 11) } }),
    { value: '1886-03/1888-02-20', label: null });
  assert.deepEqual(periodOf({ qualifiers: q('P580', '+1889-05-03T00:00:00Z', 11) }), { value: '1889-05-03', label: 'from 3 May 1889' });
  assert.equal(periodOf({}), null);
});
