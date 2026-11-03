// Dates in the Japanese, Korean and Chinese calendars (migration 185): era years are lunar years until the solar
// calendar, an era change inside a year gives "Keiō 4 / Meiji 1", the Southern Court beside the Northern, Joseon's reign
// years from the year after the accession; the API's `eras` for entries of these countries only.
const { test, expect, sql, API } = require('./helpers');

const era = (cal, range) => JSON.parse(sql(`SELECT era_label('${cal}', '${range}')`) || 'null');
const labels = (cal, range) => (era(cal, range)?.parts ?? []).map((p) => p.label);

test('era years: lunar years, changes inside a year, two courts, reign years', () => {
  expect(era('jp', '[1831-01-01,1832-01-01)')).toEqual({ calendar: 'jp', parts: [{ label: 'Tenpō 2', native: '天保2年', eras: [{ name: 'Tenpō' }] }], sexagenary: '辛卯', approx: false });
  expect(labels('jp', '[1831-01-20,1831-01-21)')).toEqual(['Bunsei 13']);           // before the lunar new year 1831
  expect(labels('jp', '[1868-01-01,1869-01-01)')).toEqual(['Keiō 4 / Meiji 1']);
  expect(labels('jp', '[1830-01-01,1833-01-01)')).toEqual(['Bunsei 13 – Tenpō 3']);
  expect(era('jp', '[1830-01-01,1833-01-01)').parts[0].eras.map((x) => x.name)).toEqual(['Bunsei', 'Tenpō']);   // for links (187)
  expect(labels('jp', '[0752-01-01,0753-01-01)')).toEqual(['Tenpyō-shōhō 4']);       // the Great Buddha's eye-opening
  expect(labels('jp', '[1937-06-01,1937-06-02)')).toEqual(['Shōwa 12']);
  expect(era('jp', '[1340-01-01,1341-01-01)').parts.map(({ eras, ...p }) => p)).toEqual([{ label: 'Ryakuō 3', native: '暦応3年' },
    { line: 'Southern Court', label: 'Engen 5 / Kōkoku 1', native: '延元5年 / 興国元年' }]);
  expect(era('kr', '[1446-01-01,1447-01-01)').parts).toEqual([{ label: 'Sejong 28', native: '世宗 28年', hangul: '세종 28년', eras: [{ name: 'Sejong' }] }]);
  expect(labels('kr', '[1725-01-10,1725-01-11)')).toEqual(['Gyeongjong 4']);          // Yeongjo's year 1 is the year after
  expect(labels('kr', '[1910-01-01,1911-01-01)')).toEqual(['Yunghui 4']);
  expect(era('cn', '[1740-01-01,1741-01-01)').parts).toEqual([{ line: 'Qing', label: 'Qianlong 5', native: '乾隆5年', eras: [{ name: 'Qianlong' }] }]);
  expect(era('jp', '[1201-01-01,1301-01-01)')).toBeNull();                           // a century: none
  // a month across a lunar new year (186): "January 1181" — the burning of Nara before Jishō 5 began on the 24th
  expect(labels('jp', '[1181-01-01,1181-02-01)')).toEqual(['Jishō 4–5']);
  expect(labels('jp', '[1160-01-01,1160-02-01)')).toEqual(['Heiji 1']);              // Eiryaku (dated to its month) not yet
  expect(sql("SELECT day FROM lunar_new_years WHERE year = 1852")).toBe('1852-02-20');  // a leap month before the new year
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

// 195: Korea before 1392 and China before 1368 (DILA Time Authority): the kings' reign years of Goryeo and of the Three
// Kingdoms side by side, China's line of succession with Song and Yuan side by side until 1279, no year 0
test('era years before 1400: Goryeo and the Three Kingdoms, Tang to Yuan', () => {
  const parts = (cal, range) => (era(cal, range)?.parts ?? []).map((p) => `${p.line ?? ''}: ${p.label}`);
  expect(era('kr', '[1299-01-01,1300-01-01)').parts).toEqual([expect.objectContaining({ line: 'Goryeo', label: 'Chungnyeol 25', native: '忠烈王 25年', hangul: '충렬왕 25년' })]);
  expect(labels('kr', '[0725-01-01,0726-01-01)')).toEqual(['Seongdeok 24']);              // the Sangwonsa bell
  expect(parts('kr', '[0414-01-01,0415-01-01)')).toContain('Goguryeo: Jangsu 2');           // the Gwanggaeto stele
  // across the beginning of our era: 57 BC is Hyeokgeose 1, 1 BC 57, 1 CE 58
  expect(parts('kr', '[0001-03-01 BC,0001-03-02 BC)')).toContain('Silla: Hyeokgeose Geoseogan 57');
  expect(parts('kr', '[0001-03-01,0001-03-02)')).toContain('Silla: Hyeokgeose Geoseogan 58');
  expect(labels('cn', '[0751-01-01,0752-01-01)')).toEqual(['Tianbao 10']);
  expect(labels('cn', '[1127-01-01,1128-01-01)')).toEqual(['Jingkang 2 / Jianyan 1']);
  expect(labels('cn', '[1126-01-30,1126-01-31)')).toEqual(['Xuanhe 7']);                    // Qinzong kept Huizong's era (208)
  expect(parts('cn', '[1278-06-01,1278-06-02)')).toEqual(['Song: Xiangxing 1', 'Yuan: Zhiyuan 15']);
  expect(era('cn', '[0761-12-01,0761-12-02)')).toBeNull();                                  // Suzong's months without an era name
  // every year of Goryeo and of China 618–1367 has its era
  expect(sql("SELECT count(*) FROM generate_series(919, 1391) y WHERE era_label('kr', daterange(make_date(y, 1, 1), make_date(y + 1, 1, 1))) IS NULL")).toBe('0');
  expect(sql("SELECT string_agg(y::text, ',') FROM generate_series(619, 1367) y WHERE era_label('cn', daterange(make_date(y, 1, 1), make_date(y + 1, 1, 1))) IS NULL")).toBe('');
});
