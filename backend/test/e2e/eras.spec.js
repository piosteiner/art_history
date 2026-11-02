// Dates in the Japanese, Korean and Chinese calendars (migration 185): era years are lunar years until the solar
// calendar, an era change inside a year gives "Keiō 4 / Meiji 1", the Southern Court beside the Northern, Joseon's reign
// years from the year after the accession; the API's `eras` for entries of these countries only.
const { test, expect, sql, API } = require('./helpers');

const era = (cal, range) => JSON.parse(sql(`SELECT era_label('${cal}', '${range}')`) || 'null');
const labels = (cal, range) => (era(cal, range)?.parts ?? []).map((p) => p.label);

test('era years: lunar years, changes inside a year, two courts, reign years', () => {
  expect(era('jp', '[1831-01-01,1832-01-01)')).toEqual({ calendar: 'jp', parts: [{ label: 'Tenpō 2', native: '天保2年' }], sexagenary: '辛卯', approx: false });
  expect(labels('jp', '[1831-01-20,1831-01-21)')).toEqual(['Bunsei 13']);           // before the lunar new year 1831
  expect(labels('jp', '[1868-01-01,1869-01-01)')).toEqual(['Keiō 4 / Meiji 1']);
  expect(labels('jp', '[1830-01-01,1833-01-01)')).toEqual(['Bunsei 13 – Tenpō 3']);
  expect(labels('jp', '[0752-01-01,0753-01-01)')).toEqual(['Tenpyō-shōhō 4']);       // the Great Buddha's eye-opening
  expect(labels('jp', '[1937-06-01,1937-06-02)')).toEqual(['Shōwa 12']);
  expect(era('jp', '[1340-01-01,1341-01-01)').parts).toEqual([{ label: 'Ryakuō 3', native: '暦応3年' },
    { line: 'Southern Court', label: 'Engen 5 / Kōkoku 1', native: '延元5年 / 興国元年' }]);
  expect(era('kr', '[1446-01-01,1447-01-01)').parts).toEqual([{ label: 'Sejong 28', native: '世宗 28年', hangul: '세종 28년' }]);
  expect(labels('kr', '[1725-01-10,1725-01-11)')).toEqual(['Gyeongjong 4']);          // Yeongjo's year 1 is the year after
  expect(labels('kr', '[1910-01-01,1911-01-01)')).toEqual(['Yunghui 4']);
  expect(era('cn', '[1740-01-01,1741-01-01)').parts).toEqual([{ line: 'Qing', label: 'Qianlong 5', native: '乾隆5年' }]);
  expect(era('jp', '[1201-01-01,1301-01-01)')).toBeNull();                           // a century: none
  expect(era('jp', '[1600-02-14,1600-02-15)').approx).toBe(true);                    // a day close to the new year
  // every year from 701 has its Japanese era, every year of Joseon its reign year
  expect(sql("SELECT count(*) FROM generate_series(701, 2026) y WHERE era_label('jp', daterange(make_date(y, 1, 1), make_date(y + 1, 1, 1))) IS NULL")).toBe('0');
  expect(sql("SELECT count(*) FROM generate_series(1392, 1910) y WHERE era_label('kr', daterange(make_date(y, 1, 1), make_date(y + 1, 1, 1))) IS NULL")).toBe('0');
});

test('the API gives a Japanese work its era dates, a European one none', async ({ request }) => {
  const get = async (slug) => (await request.get(`${API}/artworks/${slug}`, { headers: { Host: 'api.localhost' } })).json();
  const wave = await get('the-great-wave-off-kanagawa');
  expect(wave.eras.created).toEqual(expect.objectContaining({ calendar: 'jp', parts: [expect.objectContaining({ label: expect.stringMatching(/Tenpō/) })] }));
  expect((await get('the-starry-night')).eras).toBeNull();
});
