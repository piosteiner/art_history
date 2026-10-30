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

test('centuries and decades written out, with the text as label', () => {
  assert.deepEqual(parseFuzzyDate('13th century'), { range: '[1201-01-01,1301-01-01)', label: '13th century' });
  assert.deepEqual(parseFuzzyDate('Late 13th c.'), { range: '[1267-01-01,1301-01-01)', label: 'late 13th century' });
  assert.equal(parseFuzzyDate('early 13th century').range, '[1201-01-01,1234-01-01)');
  assert.equal(parseFuzzyDate('mid 13th century').range, '[1234-01-01,1267-01-01)');
  assert.deepEqual(parseFuzzyDate('first half of 13th century'), { range: '[1201-01-01,1251-01-01)', label: 'first half of the 13th century' });
  assert.equal(parseFuzzyDate('second half of the 13th century').range, '[1251-01-01,1301-01-01)');
  assert.deepEqual(parseFuzzyDate('13th–14th century'), { range: '[1201-01-01,1401-01-01)', label: '13th–14th century' });
  assert.deepEqual(parseFuzzyDate('1st century'), { range: '[0001-01-01,0101-01-01)', label: '1st century' });
  assert.deepEqual(parseFuzzyDate('5th century BCE'), { range: '[0500-01-01 BC,0400-01-01 BC)', label: '5th century BCE' });
  assert.equal(parseFuzzyDate('late 1st century BC').range, '[0034-01-01 BC,0001-01-01)');  // 34–1 BCE
  assert.deepEqual(parseFuzzyDate('21st century', { openEnd: true }).label, '21st century');
  assert.deepEqual(parseFuzzyDate('1880s'), { range: '[1880-01-01,1890-01-01)', label: '1880s' });
  assert.throws(() => parseFuzzyDate('1200s'), /ambiguous/);
  assert.throws(() => parseFuzzyDate('early 13th–14th century'), /single century/);
  assert.throws(() => parseFuzzyDate('0th century'), /bad century/);
});

test('circa: ±5 years, the label as written', () => {
  assert.deepEqual(parseFuzzyDate('c. 1755'), { range: '[1750-01-01,1761-01-01)', label: 'c. 1755' });
  for (const t of ['ca. 1755', 'circa 1755', 'c.1755', 'Ca 1755', 'CIRCA  1755']) assert.equal(parseFuzzyDate(t).range, '[1750-01-01,1761-01-01)', t);
  assert.deepEqual(parseFuzzyDate('c. 1755–1760'), { range: '[1750-01-01,1766-01-01)', label: 'c. 1755–1760' });
  assert.equal(parseFuzzyDate('ca. 1755-1760').label, 'c. 1755–1760');
  assert.deepEqual(parseFuzzyDate('c. 500 BCE'), { range: '[0505-01-01 BC,0494-01-01 BC)', label: 'c. 500 BCE' });
  assert.equal(parseFuzzyDate('c. 3').range, '[0003-01-01 BC,0009-01-01)');   // 3 BCE … 8 CE: no year 0
  assert.throws(() => parseFuzzyDate('c. 1760–1755'), /end is before start/);
});

test('leap years (proleptic Gregorian, like Postgres)', () => {
  assert.equal(parseFuzzyDate('1888-02-29').range, '[1888-02-29,1888-03-01)');
  assert.throws(() => parseFuzzyDate('1900-02-29'), /bad day/);
  assert.equal(parseFuzzyDate('2000-02-29').range, '[2000-02-29,2000-03-01)');
});

test('rejects malformed input', () => {
  for (const bad of ['c 1480 x', '1888-13', '1888-02-30', '1890/1880', '1/2/3', '18880', '']) {
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
  // a single day on the last of a month or year is that day (Matisse's birth was "1869-12-31/1869-12")
  assert.equal(formatFuzzyDate('[1869-12-31,1870-01-01)'), '1869-12-31');
  assert.equal(formatFuzzyDate('[1889-06-30,1889-07-01)'), '1889-06-30');
  assert.equal(formatFuzzyDate('[1888-02-29,1888-03-01)'), '1888-02-29');
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

test('dates known from one side, and written-out dates (063, provenance)', () => {
  const p = (s) => { const r = parseFuzzyDate(s); return [r.range, r.label]; };
  assert.deepStrictEqual(p('26 March 1952'), ['[1952-03-26,1952-03-27)', '26 March 1952']);
  assert.deepStrictEqual(p('March 1952'), ['[1952-03-01,1952-04-01)', 'March 1952']);
  assert.deepStrictEqual(p('1952-03-26 or later'), ['[1952-03-26,)', '26 March 1952 or later']);
  assert.deepStrictEqual(p('at the earliest 26 March 1952'), ['[1952-03-26,)', '26 March 1952 or later']);
  assert.deepStrictEqual(p('by 1904-10-28'), ['(,1904-10-29)', '28 October 1904 or earlier']);
  assert.deepStrictEqual(p('after 1952'), ['[1953-01-01,)', 'after 1952']);
  assert.deepStrictEqual(p('before 1928'), ['(,1928-01-01)', 'before 1928']);
  assert.deepStrictEqual(p('1901/28 October 1904'), ['[1901-01-01,1904-10-29)', '1901–28 October 1904']);
  assert.strictEqual(formatFuzzyDate('(,1904-10-29)'), '1904-10-28 or earlier');
  // a BCE bound as a year — BCE dates exist only as years (Jōmon, "c. 11,000–400 BCE", 2026-10-30); CE ones stay days
  assert.strictEqual(formatFuzzyDate('(,0394-01-01 BC)'), '-395 or earlier');
  assert.strictEqual(p('-395 or earlier')[0], '(,0394-01-01 BC)');
  assert.strictEqual(formatFuzzyDate('(,1958-01-01)'), '1957-12-31 or earlier');
});

test('forms provenance sources write: between … and …, Roman months, German numeric dates (077)', () => {
  const p = (s) => { const r = parseFuzzyDate(s); return [r.range, r.label]; };
  assert.deepStrictEqual(p('between 1917 and 1930'), ['[1917-01-01,1931-01-01)', '1917–1930']);
  assert.deepStrictEqual(p('13.VI.1913'), ['[1913-06-13,1913-06-14)', '13 June 1913']);
  assert.deepStrictEqual(p('1.7.1949'), ['[1949-07-01,1949-07-02)', '1 July 1949']);
  assert.deepStrictEqual(p('7.1934'), ['[1934-07-01,1934-08-01)', 'July 1934']);
  assert.deepStrictEqual(p('1.7.1949 or earlier'), ['(,1949-07-02)', '1 July 1949 or earlier']);
  assert.throws(() => parseFuzzyDate('32.13.1891'));   // no such month: left alone, then refused
});

test('ranges as people write them (099): any two forms, with -, –, " - ", "to"; open ends', () => {
  const r = (s, o) => parseFuzzyDate(s, o);
  for (const s of ['1900-1905', '1900–1905', '1900 - 1905', '1900 to 1905', '1900 – 1905']) {
    assert.deepEqual(r(s), { range: '[1900-01-01,1906-01-01)', label: '1900–1905' }, s);
  }
  assert.equal(r('1900-05').label, 'May 1900');                                // YYYY-MM as before
  assert.deepEqual(r('c. 1900–c. 1905'), { range: '[1895-01-01,1911-01-01)', label: 'c. 1900–c. 1905' });
  assert.deepEqual(r('March 1900 – May 1905'), { range: '[1900-03-01,1905-06-01)', label: 'March 1900–May 1905' });
  assert.equal(r('20 May 1890 – 29 July 1890').label, '20 May–29 July 1890');
  assert.deepEqual(r('1880s–1890s'), { range: '[1880-01-01,1900-01-01)', label: '1880s–1890s' });
  assert.equal(r('late 19th century–1920').range, '[1867-01-01,1921-01-01)');
  assert.deepEqual(r('500 BCE'), { range: '[0500-01-01 BC,0499-01-01 BC)', label: '500 BCE' });
  assert.equal(r('500 BCE–400 BCE').range, '[0500-01-01 BC,0399-01-01 BC)');
  // open: Wikidata's "c. 965" start of a polity that still exists
  assert.deepEqual(r('c. 965/', { openEnd: true }), { range: '[0960-01-01,)', label: 'since c. 965' });
  assert.deepEqual(r('from 1900', { openEnd: true }), { range: '[1900-01-01,)', label: 'since 1900' });
  assert.deepEqual(r('1900–', { openEnd: true }), { range: '[1900-01-01,)', label: 'since 1900' });
  assert.throws(() => r('from 1900'), /only allowed for periods/);
  assert.deepEqual(r('until 1905'), { range: '(,1906-01-01)', label: 'until 1905' });
  assert.deepEqual(r('–1905'), { range: '(,1906-01-01)', label: 'until 1905' });
  // still refused
  assert.throws(() => r('1905-1900'), /end is before start/);
  assert.throws(() => r('/1808', { openEnd: true }), /bad date/);
  assert.throws(() => r('1900-13'), /bad month/);
  assert.throws(() => r('nonsense'), /bad date/);
});

test('a range whose start leaves out what it shares with the end: "15–31 March 1901", "May–October 1909"', () => {
  // was: "15" read as the year 15 → [0015-01-01,1901-04-01)
  assert.deepEqual(parseFuzzyDate('15–31 March 1901'), { range: '[1901-03-15,1901-04-01)', label: '15–31 March 1901' });
  assert.deepEqual(parseFuzzyDate('May–October 1909'), { range: '[1909-05-01,1909-11-01)', label: 'May–October 1909' });
  assert.deepEqual(parseFuzzyDate('20 May–29 July 1890'), { range: '[1890-05-20,1890-07-30)', label: '20 May–29 July 1890' });
  // written out in full, the label is shortened the same way
  assert.equal(parseFuzzyDate('15 March 1901–31 March 1901').label, '15–31 March 1901');
  // years stay years; the end before the start is still an error
  assert.equal(parseFuzzyDate('1900–1905').range, '[1900-01-01,1906-01-01)');
  assert.throws(() => parseFuzzyDate('31–15 March 1901'), /end is before start/);
});
