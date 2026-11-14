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
  const body = await res.json();
  assert.equal(body.totalCount, 0);
  assert.deepEqual(body.results, []);
});

test('a search whose hits all fail their detail lookup is never reported as "no results"', async () => {
  const res = await fetch(`${server.base}/search?query=detailsfail&countryCode=us`);
  const body = await res.json();
  // Today this is a 500. A backend that can answer from the search hits alone
  // may return them instead; what must not happen is a 200 with nothing in it.
  if (res.status === 200) {
    assert.ok(body.totalCount > 0, 'store hits with failed lookups must not look like an empty search');
  } else {
    assert.equal(res.status, 500);
    assert.ok(body.error);
  }
});

test('a numeric App Store id resolves to that app instead of a keyword search', async () => {
  const res = await fetch(`${server.base}/search?query=389801252&countryCode=us`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totalCount, 1);
  assert.equal(body.results[0].appId, 'com.burbn.instagram');
  assert.equal(body.results[0].source, 'primary search');
});

test('a numeric developer id falls back to a keyword search', async () => {
  const res = await fetch(`${server.base}/search?query=284882218&countryCode=us`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totalCount, 1);
  assert.equal(body.results[0].appId, 'com.example.unrelated');
  assert.equal(body.results[0].source, 'primary search');
});

test('an all-digit query that is not an App Store id falls back to a keyword search', async () => {
  const res = await fetch(`${server.base}/search?query=2048&countryCode=us`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totalCount, 1);
  assert.equal(body.results[0].appId, 'com.example.unrelated');
  assert.equal(body.results[0].source, 'primary search');
});

test('a bundle id still resolves to that app', async () => {
  const res = await fetch(`${server.base}/search?query=com.burbn.instagram&countryCode=us`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totalCount, 1);
  assert.equal(body.results[0].appId, 'com.burbn.instagram');
});
