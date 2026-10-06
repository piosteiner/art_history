// Loads country and first-level region outlines from Natural Earth (public domain) into the table boundaries
// (migration 032), keyed by ISO code (JP, JP-13). Idempotent: rows are upserted; re-running updates them.
//
//   npm run boundaries                      # production DB, downloads the Natural Earth GeoJSON files
//   npm run boundaries:dev                  # arthistory_dev
//   node scripts/boundaries.js --file x.geojson [--file y.geojson]   # local files (the e2e fixtures)
//
// Outlines are simplified (ST_SimplifyPreserveTopology, ~1 km) and repaired (ST_MakeValid) in Postgres, which
// keeps them light for the website's map. Afterwards, countries without a boundary code get the one matching their
// country code (recorded in the history with source "boundaries").
const fs = require('fs');
const { Client } = require('pg');
const config = require('../src/config');

const SOURCES = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson',
];
const files = process.argv.flatMap((a, i) => (a === '--file' ? [process.argv[i + 1]] : []));

// a Natural Earth feature → { code, name, level, country_code, x, y } or null (no usable ISO code)
function describe(f) {
  const p = f.properties || {};
  const admin1 = p.iso_3166_2 !== undefined;
  if (admin1) {
    const code = String(p.iso_3166_2 || '');
    if (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(code)) return null;
    return { code, name: p.name || p.name_en || code, level: 1, country_code: code.slice(0, 2), x: p.longitude, y: p.latitude };
  }
  const code = [p.ISO_A2_EH, p.ISO_A2, p.iso_a2].find((c) => /^[A-Z]{2}$/.test(String(c || '')));
  if (!code) return null;
  return { code, name: p.NAME || p.ADMIN || p.name || code, level: 0, country_code: code, x: p.LABEL_X, y: p.LABEL_Y };
}

async function load(source) {
  if (fs.existsSync(source)) return JSON.parse(fs.readFileSync(source, 'utf8'));
  console.log(`downloading ${source.split('/').pop()} …`);
  const res = await fetch(source, { headers: { 'User-Agent': 'arthistory-boundaries/1.0 (+https://arthistory.piogino.ch)' } });
  if (!res.ok) throw new Error(`${source}: ${res.status}`);
  return res.json();
}

async function main() {
  const client = new Client({ connectionString: config.db.ownerUrl, application_name: 'arthistory-boundaries' });
  await client.connect();
  const seen = new Set();
  let n = 0;
  try {
    await client.query('BEGIN');
    for (const source of files.length ? files : SOURCES) {
      const data = await load(source);
      for (const f of data.features || []) {
        const d = describe(f);
        if (!d || seen.has(d.code) || !f.geometry) continue;  // Natural Earth has a few duplicate codes: first wins
        seen.add(d.code);
        const label = Number.isFinite(d.x) && Number.isFinite(d.y) ? `SRID=4326;POINT(${d.x} ${d.y})` : null;
        await client.query(`
          WITH g AS (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
                       ST_SimplifyPreserveTopology(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), 0.01)), 3)) AS geom)
          INSERT INTO boundaries (code, name, level, country_code, geom, label_point)
          SELECT $1, $2, $3, $4, g.geom::geography,
                 coalesce($6::geography, ST_PointOnSurface(g.geom)::geography) FROM g WHERE NOT ST_IsEmpty(g.geom)
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level, country_code = EXCLUDED.country_code,
            geom = EXCLUDED.geom, label_point = EXCLUDED.label_point`,
        [d.code, d.name, d.level, d.country_code, JSON.stringify(f.geometry), label]);
        n += 1;
      }
    }
    // countries without an outline: their boundary from the country code (the trigger does this on every save too)
    await client.query("SELECT set_config('arthistory.source', 'boundaries', true)");
    const { rowCount } = await client.query(`
      UPDATE places p SET boundary_code = p.country_code
      WHERE p.kind = 'country' AND p.boundary_code IS NULL AND p.area IS NULL
        AND EXISTS (SELECT 1 FROM boundaries b WHERE b.code = p.country_code AND b.level = 0)`);
    await client.query('COMMIT');
    console.log(`✓ ${n} boundaries loaded into ${config.db.name}; ${rowCount} countr${rowCount === 1 ? 'y' : 'ies'} linked`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(`✗ ${err.message}`); process.exit(1); });
