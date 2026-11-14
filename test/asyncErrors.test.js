// An async route handler that rejects must still answer the request. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, delay } = require('./support/server');

let server;
test.before(async () => {
  server = await startServer({ APP_STORE_STUB: 'brokenlist' });
});
test.after(() => server.stop());

test('GET /toplists answers rejected handlers with JSON and keeps the server alive', async () => {
  const res = await fetch(
    `${server.base}/toplists?collection=topfreeapplications&category=6005&categoryName=SOCIAL_NETWORKING&country=us`,
    { signal: AbortSignal.timeout(5000) }
  );
  assert.equal(res.status, 500);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const bodyText = await res.text();
  assert.deepEqual(JSON.parse(bodyText), { error: 'An unexpected error occurred.' });
  assert.doesNotMatch(bodyText, /at |listController/);

  const health = await fetch(`${server.base}/health`);
  assert.equal(health.status, 200);
  assert.ok(server.alive(), 'the server must remain alive after the rejected handler');
  await delay(100);
  assert.match(server.output(), /\[SERVER\] Unhandled error/);
  assert.doesNotMatch(server.output(), /\[SERVER\] Unhandled promise rejection/);
});
