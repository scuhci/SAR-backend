// GET /toplists input validation. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, delay } = require('./support/server');

let server;
test.before(async () => {
  server = await startServer();
});
test.after(() => server.stop());

const listCalls = () => server.count(/\[STUB\] scraper call: list /g);

test('GET /toplists without collection returns 400 and the server keeps running', async () => {
  const before = listCalls();
  const res = await fetch(`${server.base}/toplists?category=6005&categoryName=SOCIAL_NETWORKING&country=us`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /collection/);
  await delay(200);
  assert.ok(server.alive(), 'the request must not take the process down');
  assert.equal(listCalls(), before, 'the scraper must not be called for a bad request');

  const ok = await fetch(
    `${server.base}/toplists?collection=topfreeapplications&category=6005&categoryName=SOCIAL_NETWORKING&country=us`
  );
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).totalCount, 2);
});

test('GET /toplists with an unknown collection returns 400', async () => {
  const before = listCalls();
  const res = await fetch(`${server.base}/toplists?collection=nope&category=6005&country=us`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /collection/);
  assert.equal(listCalls(), before);
});
