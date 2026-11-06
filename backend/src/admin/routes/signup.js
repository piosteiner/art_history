// Sign-up (migration 220, owner 2026-11-05: "self service sign up"): anyone may make a site-only account (role member:
// study sets, the quiz with its own results — never the CMS) while the owner has sign-up open (CMS → Accounts).
//   GET  /signup[?next=<site address>]    the form: username, public name (optional), password twice, the privacy note
//   POST /signup                          → the account, logged in, back to the site (next, else /sets)
// No e-mail address is asked (nothing to send one; nothing to keep): a forgotten password is set anew by an admin.
// Brakes against scripts: a hidden field people leave empty, at most 3 sign-ups per address an hour (in memory), the
// owner's limit per day across the site (site_settings.signup_daily_limit), the origin check of every CMS form.
const express = require('express');
const config = require('../../config');
const { html } = require('../html');
const { send } = require('../core');
const { adminPool } = require('../../db');
const { startSession, passwordProblem, USERNAME, MIN_PASSWORD } = require('../auth');
const accounts = require('../accounts');
const { siteUrl } = require('./site-account');

const router = express.Router();
const PER_HOUR = 3;
const recent = new Map();   // ip → [times of sign-ups in the last hour]
const tooMany = (ip) => (recent.get(ip) || []).filter((t) => Date.now() - t < 3600e3).length >= PER_HOUR;
const count = (ip) => recent.set(ip, [...(recent.get(ip) || []).filter((t) => Date.now() - t < 3600e3), Date.now()]);

const page = ({ error, next, values = {}, closed }) => html`<div class="login signup"><p class="login-back small"><a href="${next || config.corsOrigin}">← Back to the site</a></p><h1>Create an account</h1>
  ${closed ? html`<p class="flash warn">${closed}</p>` : html`
  <p class="muted small">For the site <a href="${config.corsOrigin}">${config.corsOrigin.replace(/^https?:\/\//, '')}</a>: your own study sets
    (to learn as index cards, to share, to edit together) and your quiz results. Not the CMS. No e-mail address needed.</p>
  ${error ? html`<p class="flash error">${error}</p>` : ''}
  <form method="post" action="/signup" class="form">
    ${next ? html`<input type="hidden" name="next" value="${next}">` : ''}
    <div class="field"><label for="u">Username <span class="muted small">— only for logging in, never shown to anyone; 2–40 small letters, digits, _ . -</span></label>
      <input id="u" name="username" value="${values.username || ''}" autocomplete="username" required pattern="[a-z0-9_.\\-]{2,40}" maxlength="40" autofocus autocapitalize="none" spellcheck="false"></div>
    <div class="field"><label for="n">Public name <span class="muted small">— optional; how others see you</span></label>
      <input id="n" name="public_name" value="${values.public_name || ''}" maxlength="60" autocomplete="nickname">
      <p class="hint">Others see this name — never your username — when you share a set, edit one together with others, or have friends and chat with them. Without one you can still keep and learn your own sets; you can add it later under “Your account”.</p></div>
    <div class="field"><label for="p">Password <span class="muted small">— at least ${String(MIN_PASSWORD)} characters</span></label>
      <input id="p" name="password" type="password" autocomplete="new-password" required minlength="${String(MIN_PASSWORD)}"></div>
    <div class="field"><label for="p2">Password again</label><input id="p2" name="password2" type="password" autocomplete="new-password" required></div>
    <div class="field signup-website" aria-hidden="true"><label for="w">Leave this empty</label><input id="w" name="website" tabindex="-1" autocomplete="off"></div>
    <div class="field"><label class="check"><input type="checkbox" name="privacy" value="1" required${values.privacy ? ' checked' : ''}>
      <span>I have read the <a href="${config.corsOrigin}/privacy" target="_blank" rel="noopener">privacy statement</a> (what an account keeps, and that I can delete it).</span></label></div>
    <div class="actions"><button>Create account</button></div>
  </form>
  <p class="small">Keep your password safe: there is no e-mail to reset it — if it is lost, the site's owner can set a new one.</p>`}
  <p class="small"><a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}">Log in instead</a></p></div>`;

async function closedReason() {
  const s = await accounts.signupSettings();
  if (!s.open) return 'Sign-up is closed at the moment.';
  if (s.today >= s.daily_limit) return 'Too many new accounts today — please try again tomorrow.';
  return null;
}

router.get('/signup', async (req, res) => {
  const next = siteUrl(req.query.next);
  if (req.user) return res.redirect(next || `${config.corsOrigin}/sets`);
  send(req, res, { title: 'Create an account', body: page({ next, closed: await closedReason() }) });
});

router.post('/signup', async (req, res) => {
  const next = siteUrl(req.body.next);
  const values = { username: String(req.body.username || '').trim().toLowerCase(), public_name: String(req.body.public_name || '').trim(), privacy: req.body.privacy === '1' };
  const again = (error, status = 422) => send(req, res, { title: 'Create an account', status, body: page({ error, next, values }) });
  const closed = await closedReason();
  if (closed) return send(req, res, { title: 'Create an account', status: 403, body: page({ next, closed }) });
  if (req.body.website) return again('Something went wrong — please try again.');   // a script filled the hidden field
  if (tooMany(req.ip)) return again('Too many new accounts from your connection — try again in an hour.', 429);
  if (!USERNAME.test(values.username)) return again('A username has 2–40 small letters, digits, _ . or -.');
  if (values.public_name.length > 60) return again('A public name has at most 60 characters.');
  if (values.public_name && values.public_name.toLowerCase() === values.username) return again('Choose a public name other than your username — the username is half of your login.');
  const weak = passwordProblem(req.body.password, values.username);
  if (weak) return again(weak);
  if (req.body.password !== req.body.password2) return again('The two passwords differ.');
  if (!values.privacy) return again('Please read the privacy statement and tick the box.');
  let user;
  try {
    user = await accounts.create(adminPool, { username: values.username, password: req.body.password, role: 'member', publicName: values.public_name || null, via: 'signup' });
  } catch (err) {
    const why = accounts.problem(err);
    if (why) return again(why);
    throw err;
  }
  count(req.ip);
  await startSession(req, res, user);
  console.log(`account signed up: ${user.username} (#${user.id})`);
  res.redirect(303, next || `${config.corsOrigin}/sets?login=1&welcome=1`);
});

module.exports = router;
