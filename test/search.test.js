// GET /search outcomes. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./support/server');

let server;
test.before(async () => {
  server = await startServer();
});
test.after(() => server.stop());

test('a search with no App Store hits returns 200 with an empty result set', async () => {
  const res = await fetch(`${server.base}/search?query=zzznomatch&countryCode=us`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { totalCount: 0, results: [] });
});

test('a search whose hits all fail their detail lookup is still an error, not "no results"', async () => {
  const res = await fetch(`${server.base}/search?query=detailsfail&countryCode=us`);
  assert.equal(res.status, 500);
  assert.ok((await res.json()).error);
});

test('a numeric App Store id resolves to that app instead of a keyword search', async () => {
  const res = await fetch(`${server.base}/search?query=389801252&countryCode=us`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totalCount, 1);
  assert.equal(body.results[0].appId, 'com.burbn.instagram');
  assert.equal(body.results[0].source, 'primary search');
});

test('a bundle id still resolves to that app', async () => {
  const res = await fetch(`${server.base}/search?query=com.burbn.instagram&countryCode=us`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totalCount, 1);
  assert.equal(body.results[0].appId, 'com.burbn.instagram');
});
