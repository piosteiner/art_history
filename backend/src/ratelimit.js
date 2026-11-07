// A small rate limit per client address (2026-11-07, after the code review: the public API had none — one client could
// keep the server busy with the full-text search, a second each). A token bucket per IP: `burst` requests at once,
// refilled at `perMinute`; over it → 429 with Retry-After. In memory, per process (one process today); buckets not
// used for ten minutes are dropped. req.ip is the client's address: app.js trusts nginx on the same host.
//   app.use('/v1', rateLimit({ perMinute: 600, burst: 120 }))               the lists, previews, map …
//   router.get('/search/text', rateLimit({ perMinute: 60, burst: 20 }), …)  the expensive one
// Not for the admin panel: its sessions are few, and fail2ban watches the login.
const SWEEP_MS = 60 * 1000;
const IDLE_MS = 10 * 60 * 1000;

function rateLimit({ perMinute, burst = perMinute, name = 'api' }) {
  const buckets = new Map();   // ip → { tokens, at }
  const rate = perMinute / 60000;   // tokens per ms
  let lastSweep = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > SWEEP_MS) {
      lastSweep = now;
      for (const [ip, b] of buckets) if (now - b.at > IDLE_MS) buckets.delete(ip);
    }
    const ip = req.ip || 'unknown';
    const b = buckets.get(ip) || { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + (now - b.at) * rate);
    b.at = now;
    if (b.tokens < 1) {
      buckets.set(ip, b);
      const wait = Math.ceil((1 - b.tokens) / rate / 1000);
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: 'too_many_requests', message: `Too many requests (${name}) — try again in ${wait} s.` });
    }
    b.tokens -= 1;
    buckets.set(ip, b);
    next();
  };
}

module.exports = { rateLimit };
