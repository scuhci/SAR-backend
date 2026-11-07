// Starts index.js as a child process on a free port with app-store-scraper
// stubbed (see appStoreStub.js). Resolves once the server is listening and the
// startup health check has finished.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const STUB = path.join(__dirname, 'appStoreStub.js');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['-r', STUB, 'index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HEALTH_FAILURE_THRESHOLD: '3',
      HEALTH_CHECK_INTERVAL_MS: '600000', // no periodic check during a test
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  const deadline = Date.now() + 15000;
  while (!output.includes('[HEALTH] Scraper health check completed')) {
    if (child.exitCode !== null) throw new Error('server exited early:\n' + output);
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('server did not start:\n' + output);
    }
    await delay(50);
  }

  return {
    base: `http://127.0.0.1:${port}`,
    output: () => output,
    alive: () => child.exitCode === null && child.signalCode === null,
    count: (pattern) => (output.match(pattern) || []).length,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.on('exit', resolve);
        child.kill();
      }),
  };
}

module.exports = { startServer, delay };
