// Create an admin user, or set a new password for an existing one. Runs as arthistory_owner
// (the app's own role may not create users — see migration 006).
//
//   npm run admin:user -- pio            # asks for the password (twice)
//   npm run admin:user:dev -- pio
//   echo "$PASSWORD" | npm run admin:user -- pio     # from stdin, for scripts
//   npm run admin:user -- anna --role member         # role (220): member (site only) · editor (CMS) · admin (CMS +
//                                                    # accounts); a new account without --role is an editor, an
//                                                    # existing one keeps its role unless --role is given
// Accounts are managed in the CMS too (Accounts, admins only) — this script is for the first admin and for scripts.
const readline = require('readline');
const { Client } = require('pg');
const config = require('../src/config');
const { hashPassword } = require('../src/admin/auth');

async function ask(question, hidden) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = () => {};  // don't echo the password
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  if (hidden) process.stdout.write('\n');
  return answer;
}

async function readPassword() {
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, '');
  }
  process.stdout.write('Password: ');
  const a = await ask('', true);
  process.stdout.write('Again: ');
  const b = await ask('', true);
  if (a !== b) throw new Error('passwords differ');
  return a;
}

async function main() {
  const username = String(process.argv[2] || '').toLowerCase();
  if (!/^[a-z0-9_.-]{2,40}$/.test(username)) throw new Error('usage: admin-user.js <username> [--role member|editor|admin]  (a-z 0-9 _ . -)');
  const r = process.argv.indexOf('--role');
  const role = r > 0 ? process.argv[r + 1] : null;
  if (role !== null && !['member', 'editor', 'admin'].includes(role)) throw new Error('--role is member, editor or admin');
  const password = await readPassword();
  if (password.length < 12) throw new Error('password must be at least 12 characters');

  const client = new Client({ connectionString: config.db.ownerUrl, application_name: 'arthistory-admin-user' });
  await client.connect();
  try {
    const { rows } = await client.query(`
      INSERT INTO admin_users (username, password_hash, role, created_via, password_set_at) VALUES ($1, $2, coalesce($3, 'editor')::account_role, 'script', now())
      ON CONFLICT (username) DO UPDATE SET password_hash = $2, password_set_at = now(), role = coalesce($3::account_role, admin_users.role)
      RETURNING (xmax = 0) AS created, id, role::text AS role`, [username, await hashPassword(password), role]);
    await client.query(`INSERT INTO account_log (account_id, username, action, detail) VALUES ($1, $2, $3, $4)`,
      [rows[0].id, username, rows[0].created ? 'created' : 'password_reset', { role: rows[0].role, via: 'script' }]);
    // A new password logs out every existing session of that user.
    if (!rows[0].created) {
      await client.query('DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM admin_users WHERE username = $1)', [username]);
    }
    console.log(`✓ ${rows[0].created ? 'created' : 'password changed for'} ${username} (${rows[0].role}) in ${config.db.name}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(`✗ ${err.message}`); process.exit(1); });
