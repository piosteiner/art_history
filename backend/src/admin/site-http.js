// What the site's JSON routes share (routes/site-*.js; 2026-11-07 — before, each file had its own copy):
//   fail(res, status, error)   → { error } with the status
//   needLogin                  middleware: 401 { error: 'not_logged_in' } without an account
//   ID                         an account's or set's id in an address
const fail = (res, status, error) => res.status(status).json({ error });
const needLogin = (req, res, next) => (req.user ? next() : fail(res, 401, 'not_logged_in'));
const ID = /^[1-9][0-9]{0,17}$/;

module.exports = { fail, needLogin, ID };
