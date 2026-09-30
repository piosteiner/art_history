// Start / stop / restart the test server (port 3006, database arthistory_test). Tests restart it to check that
// the live connection survives an outage.
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { PORT, BACKEND, STATE_DIR, PID_FILE, serverEnv } = require('./env');

const portOpen = () => new Promise((resolve) => {
  const s = net.connect(PORT, '127.0.0.1');
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

async function start() {
  if (await portOpen()) throw new Error(`port ${PORT} is already in use — is an old test server still running?`);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const log = fs.openSync(`${STATE_DIR}/server.log`, 'a');
  const child = spawn('node', ['src/server.js'], { cwd: BACKEND, env: serverEnv(), detached: true, stdio: ['ignore', log, log] });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  await waitFor(portOpen, 15000, 'the server to listen');
}

async function stop() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  await waitFor(async () => !(await portOpen()), 10000, 'the server to stop');
  fs.rmSync(PID_FILE, { force: true });
}

async function restart() {
  await stop();
  await start();
}

module.exports = { start, stop, restart };
