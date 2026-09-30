// Admin authentication: scrypt password hashes (Node built-in, no dependency), sessions in Postgres.
//
// Cookie: a random 256-bit token. The database stores only its SHA-256 (admin_sessions.token_hash).
// Cross-site requests: the cookie is SameSite=Strict, and every non-GET request must come from the admin host
// itself — its Origin header, or Sec-Fetch-Site: same-origin if the browser sent no usable Origin (checkOrigin). Repeated failed logins (401 on POST /login in the nginx log) are banned at the firewall by fail2ban.
const crypto = require('crypto');
const { promisify } = require('util');
const config = require('../config');
const { adminPool } = require('../db');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };  // ~100 ms per hash, 32 MB memory
const SESSION_DAYS = 7;
const COOKIE = config.env === 'production' ? '__Host-ah_session' : 'ah_session';  // __Host-: Secure, Path=/, no Domain

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(actual, expected);
}

// Same work for unknown usernames as for wrong passwords, so response time doesn't reveal which users exist.
let dummyHash;
const getDummyHash = async () => (dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex')));

const sha256 = (token) => crypto.createHash('sha256').update(token).digest();

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token, maxAgeSeconds) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (config.env === 'production') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

// Brute-force brake per IP (in memory; one process). fail2ban blocks the IP at the firewall after 5 failures anyway.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
function tooManyAttempts(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.first > WINDOW_MS) return false;
  return a.count >= MAX_ATTEMPTS;
}
function recordFailure(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.first > WINDOW_MS) attempts.set(ip, { first: now, count: 1 });
  else a.count += 1;
}

// → user row, or null. Creates the session and sets the cookie on success.
async function login(req, res, username, password) {
  if (tooManyAttempts(req.ip)) return { error: 'Too many failed attempts — try again in 15 minutes.' };
  const { rows } = await adminPool.query('SELECT id, username, password_hash FROM admin_users WHERE username = $1',
    [String(username || '').trim().toLowerCase()]);
  const user = rows[0];
  const ok = await verifyPassword(String(password || ''), user ? user.password_hash : await getDummyHash());
  if (!user || !ok) {
    recordFailure(req.ip);
    console.warn(`admin login failed for "${username}" from ${req.ip}`);
    return { error: 'Wrong username or password.' };
  }
  attempts.delete(req.ip);
  const token = crypto.randomBytes(32).toString('base64url');
  await adminPool.query('DELETE FROM admin_sessions WHERE expires_at < now()');
  await adminPool.query(`
    INSERT INTO admin_sessions (token_hash, user_id, expires_at, ip, user_agent)
    VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [sha256(token), user.id, SESSION_DAYS, req.ip, String(req.headers['user-agent'] || '').slice(0, 300)]);
  await adminPool.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [user.id]);
  setSessionCookie(res, token, SESSION_DAYS * 86400);
  return { user: { id: user.id, username: user.username } };
}

async function logout(req, res) {
  const cookie = readCookie(req, COOKIE);
  if (cookie) await adminPool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256(cookie)]);
  setSessionCookie(res, '', 0);
}

// The logged-in user of a request (Express request or the raw HTTP request of a WebSocket upgrade), or null.
async function userFromRequest(req) {
  const cookie = readCookie(req, COOKIE);
  if (!cookie) return null;
  const { rows } = await adminPool.query(`
    SELECT u.id, u.username FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(cookie)]);
  return rows[0] || null;
}

// Middleware: req.user from the session cookie, or null.
async function loadUser(req, res, next) {
  req.user = await userFromRequest(req);
  next();
}

// The only origin allowed to post to the admin site (and to open its live connection).
const adminOrigin = (req) => (config.env === 'production' ? `https://${config.adminHost}` : `http://${req.headers.host}`);

// Middleware: every state-changing request must come from a page of the admin site itself.
function checkOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const expected = adminOrigin(req);
  const origin = req.get('origin');
  if (origin === expected) return next();
  // Fallback: some privacy settings/extensions send "Origin: null" or none. Sec-Fetch-* headers can't be set by page
  // scripts, and a real cross-site request says cross-site, so "same-origin" here is trustworthy.
  if ((!origin || origin === 'null') && req.get('sec-fetch-site') === 'same-origin') return next();
  res.status(403).type('text').send('Forbidden: cross-site request.');
}

module.exports = { hashPassword, verifyPassword, login, logout, loadUser, checkOrigin, userFromRequest, adminOrigin };
