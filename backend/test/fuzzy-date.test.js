const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFuzzyDate, formatFuzzyDate } = require('../src/fuzzy-date');

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

test('open end ("still ongoing") only when allowed', () => {
  assert.deepEqual(parseFuzzyDate('1808/', { openEnd: true }), { range: '[1808-01-01,)', label: 'since 1808' });
  assert.deepEqual(parseFuzzyDate('1886-03/', { openEnd: true }), { range: '[1886-03-01,)', label: 'since March 1886' });
  assert.throws(() => parseFuzzyDate('1808/'), /only allowed for periods/);
  assert.throws(() => parseFuzzyDate('/1808', { openEnd: true }), /bad date/);
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

test('formatFuzzyDate: stored range → shortest text', () => {
  assert.equal(formatFuzzyDate('[1853-01-01,1854-01-01)'), '1853');
  assert.equal(formatFuzzyDate('[1888-02-01,1888-03-01)'), '1888-02');
  assert.equal(formatFuzzyDate('[1853-03-30,1853-03-31)'), '1853-03-30');
  assert.equal(formatFuzzyDate('[1886-03-01,1888-02-21)'), '1886-03/1888-02-20');
  assert.equal(formatFuzzyDate('[1886-01-01,1886-03-01)'), '1886-01/1886-02');
  assert.equal(formatFuzzyDate('[1478-01-01,1483-01-01)'), '1478/1482');
  assert.equal(formatFuzzyDate('["0500-01-01 BC","0499-01-01 BC")'), '-500');
  assert.equal(formatFuzzyDate('["0001-01-01 BC",0001-01-01)'), '-1');
  assert.equal(formatFuzzyDate('[1857-05-01,1857-05-02)'), '1857-05-01');
  assert.equal(formatFuzzyDate('[1857-01-01,1857-01-02)'), '1857-01-01');
  assert.equal(formatFuzzyDate('[1886-01-01,1886-02-01)'), '1886-01');
  assert.equal(formatFuzzyDate('[1926-12-01,1927-01-01)'), '1926-12');           // December: not "1926-12/1926"
  assert.equal(formatFuzzyDate('[1886-12-01,1888-01-01)'), '1886-12/1887-12');
  assert.equal(formatFuzzyDate('[1886-03-15,1887-01-01)'), '1886-03-15/1886-12');  // 15 March–December 1886
  assert.equal(formatFuzzyDate('[1808-01-01,)'), '1808/');
  assert.equal(formatFuzzyDate('[1973-06-01,)'), '1973-06/');
  assert.equal(formatFuzzyDate(null), null);
});

test('formatFuzzyDate round-trips through parseFuzzyDate', () => {
  const unquote = (r) => r.replace(/(\d{4}-\d{2}-\d{2} BC)/g, '"$1"');
  for (const text of ['1853', '1888-02', '1853-03-30', '1886-03/1888-02-20', '1890-05-20/1890-07-29', '1478/1482',
    '-500', '-10/10', '1888-12-31', '1888-02-29', '1886-03/1888', '1808/', '1886-03/', '1900-12/1901-01', '1857-05-01', '1857-01-01', '1886-01', '1886-01/1886-02']) {
    const { range } = parseFuzzyDate(text, { openEnd: true });
    const back = formatFuzzyDate(unquote(range));
    assert.equal(parseFuzzyDate(back, { openEnd: true }).range, range, `${text} → ${back}`);
  }
});

const { thumbUrl } = require('../src/admin/images');
test('thumbUrl: Wikimedia thumbnails at the wanted width, other hosts unchanged', () => {
  const t = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/Great_Wave.jpg/1280px-Great_Wave.jpg';
  assert.equal(thumbUrl(t, 120), 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/Great_Wave.jpg/120px-Great_Wave.jpg');
  assert.equal(thumbUrl('https://upload.wikimedia.org/wikipedia/commons/e/ea/Starry_Night.jpg', 250),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Starry_Night.jpg/250px-Starry_Night.jpg');
  assert.equal(thumbUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.svg', 120), 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.svg');
  assert.equal(thumbUrl('https://www.moma.org/media/starry.jpg', 120), 'https://www.moma.org/media/starry.jpg');
  assert.equal(thumbUrl(null, 120), null);
});
