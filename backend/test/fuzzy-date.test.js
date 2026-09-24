const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFuzzyDate } = require('../src/fuzzy-date');

test('points at year, month and day precision', () => {
  assert.deepEqual(parseFuzzyDate(1853), { range: '[1853-01-01,1854-01-01)', label: '1853' });
  assert.deepEqual(parseFuzzyDate('1888-02'), { range: '[1888-02-01,1888-03-01)', label: 'February 1888' });
  assert.deepEqual(parseFuzzyDate('1853-03-30'), { range: '[1853-03-30,1853-03-31)', label: '30 March 1853' });
  assert.deepEqual(parseFuzzyDate('1888-12-31'), { range: '[1888-12-31,1889-01-01)', label: '31 December 1888' });
  assert.equal(parseFuzzyDate('1888-12').range, '[1888-12-01,1889-01-01)');
});

test('ranges are inclusive at each end\'s precision', () => {
  assert.deepEqual(parseFuzzyDate('1886-03/1888-02-20'),
    { range: '[1886-03-01,1888-02-21)', label: 'March 1886–20 February 1888' });
  assert.deepEqual(parseFuzzyDate('1478/1482'), { range: '[1478-01-01,1483-01-01)', label: '1478–1482' });
  assert.equal(parseFuzzyDate('1890-05-20/1890-07-29').label, '20 May–29 July 1890');
});

test('BCE years, and no year 0', () => {
  assert.deepEqual(parseFuzzyDate(-500), { range: '[0500-01-01 BC,0499-01-01 BC)', label: '500 BCE' });
  assert.equal(parseFuzzyDate(-1).range, '[0001-01-01 BC,0001-01-01)');
  assert.equal(parseFuzzyDate('-10/10').range, '[0010-01-01 BC,0011-01-01)');
  assert.throws(() => parseFuzzyDate(0), /no year 0/);
  assert.throws(() => parseFuzzyDate('-500-03'), /year-precision/);
});

test('leap years (proleptic Gregorian, like Postgres)', () => {
  assert.equal(parseFuzzyDate('1888-02-29').range, '[1888-02-29,1888-03-01)');
  assert.throws(() => parseFuzzyDate('1900-02-29'), /bad day/);
  assert.equal(parseFuzzyDate('2000-02-29').range, '[2000-02-29,2000-03-01)');
});

test('rejects malformed input', () => {
  for (const bad of ['c. 1480', '1888-13', '1888-02-30', '1890/1880', '1/2/3', '18880', '']) {
    assert.throws(() => parseFuzzyDate(bad), undefined, bad);
  }
  assert.equal(parseFuzzyDate(null), null);
});
