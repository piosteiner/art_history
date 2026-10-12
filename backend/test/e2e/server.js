// Start / stop / restart a test server (one per shard: env.js). Tests restart their own to check that the live
// connection survives an outage.
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const env = require('./env');

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});

async function waitFor(check, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`test server: timed out waiting for ${what}`);
}

async function start(s = env) {
  if (await portOpen(s.PORT)) throw new Error(`port ${s.PORT} is already in use — is an old test server still running?`);
  fs.mkdirSync(env.STATE_DIR, { recursive: true });
  const log = fs.openSync(s.LOG_FILE, 'a');
  const child = spawn('node', ['src/server.js'], { cwd: env.BACKEND, env: s.serverEnv(), detached: true, stdio: ['ignore', log, log] });
  child.unref();
  fs.writeFileSync(s.PID_FILE, String(child.pid));
  await waitFor(() => portOpen(s.PORT), 15000, `the server on ${s.PORT} to listen`);
}

async function stop(s = env) {
  if (!fs.existsSync(s.PID_FILE)) return;
  const pid = Number(fs.readFileSync(s.PID_FILE, 'utf8'));
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  await waitFor(async () => !(await portOpen(s.PORT)), 10000, `the server on ${s.PORT} to stop`);
  fs.rmSync(s.PID_FILE, { force: true });
}

async function restart(s = env) {
  await stop(s);
  await start(s);
}

module.exports = { start, stop, restart };
