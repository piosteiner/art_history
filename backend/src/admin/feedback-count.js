// How many feedbacks are new (migration 141) — for the menu's "Feedback 3". Pages are rendered without a query of their
// own for it: the number is kept here, refreshed every 30 seconds and right after a change on the feedback page.
const { adminPool } = require('../db');

let n = 0;
async function refresh() {
  try {
    n = (await adminPool.query("SELECT count(*)::int AS n FROM feedback WHERE status = 'new'")).rows[0].n;
  } catch { /* before migration 141, or the database away a moment: the last number stands */ }
}
refresh();
setInterval(refresh, 30000).unref();

module.exports = { newCount: () => n, refresh };
