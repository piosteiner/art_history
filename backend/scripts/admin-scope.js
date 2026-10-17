// Limit an admin account to collections (migration 094: row-level security), or lift the limit. Runs as
// arthistory_owner (the app's role may not change scopes).
//
//   npm run admin:scope -- anna kunsthaus-zurich bührle-foundation   # anna changes only artworks of these two
//   npm run admin:scope -- anna --clear                               # no limit again
//   npm run admin:scope -- anna                                       # show the scope
//   npm run admin:scope:dev -- …
const { Client } = require('pg');
const config = require('../src/config');

async function main() {
  const [username, ...rest] = process.argv.slice(2);
  if (!username) throw new Error('usage: admin-scope.js <username> [<institution slug> … | --clear]');
  const client = new Client({ connectionString: config.db.ownerUrl, application_name: 'arthistory-admin-scope' });
  await client.connect();
  try {
    const { rows: [user] } = await client.query('SELECT id FROM admin_users WHERE username = $1', [username.toLowerCase()]);
    if (!user) throw new Error(`no admin user "${username}"`);
    if (rest.length) {
      const slugs = rest.includes('--clear') ? [] : rest;
      const { rows: found } = await client.query('SELECT id, slug FROM institutions WHERE slug = ANY ($1)', [slugs]);
      const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
      if (missing.length) throw new Error(`no institution ${missing.map((s) => `"${s}"`).join(', ')}`);
      await client.query('BEGIN');
      await client.query('DELETE FROM editor_scopes WHERE user_id = $1', [user.id]);
      for (const f of found) await client.query('INSERT INTO editor_scopes (user_id, institution_id) VALUES ($1, $2)', [user.id, f.id]);
      await client.query('COMMIT');
    }
    const { rows } = await client.query(`SELECT i.slug FROM editor_scopes s JOIN institutions i ON i.id = s.institution_id
      WHERE s.user_id = $1 ORDER BY i.slug`, [user.id]);
    console.log(rows.length ? `✓ ${username} changes only artworks of: ${rows.map((r) => r.slug).join(', ')} (${config.db.name})`
      : `✓ ${username} may change everything (${config.db.name})`);
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(`✗ ${err.message}`); process.exit(1); });
