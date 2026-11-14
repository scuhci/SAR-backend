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

test('GET /toplists with an unknown category returns 400 instead of the overall chart', async () => {
  for (const category of ['foo', '99999']) {
    const before = listCalls();
    const res = await fetch(
      `${server.base}/toplists?collection=topfreeapplications&category=${category}&categoryName=X&country=us`
    );
    assert.equal(res.status, 400, `category=${category}`);
    assert.match((await res.json()).error, /category/);
    assert.equal(listCalls(), before, 'the scraper must not be called for a bad category');
  }
});

test('GET /toplists accepts the Developer Tools and Graphics & Design genres', async () => {
  for (const [id, categoryName] of [[6026, 'DEVELOPER_TOOLS'], [6027, 'GRAPHICS_AND_DESIGN']]) {
    const res = await fetch(
      `${server.base}/toplists?collection=topfreeapplications&category=${id}&categoryName=${categoryName}&country=us`
    );
    assert.equal(res.status, 200, `category=${id}`);
    assert.equal((await res.json()).totalCount, 2);
    assert.match(server.output(), new RegExp('\\[STUB\\] scraper call: list .*"category":' + id));
  }
});

test('GET /toplists still rejects the Stickers genre (empty feed)', async () => {
  const before = listCalls();
  const res = await fetch(
    `${server.base}/toplists?collection=topfreeapplications&category=6025&categoryName=STICKERS&country=us`
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /category/);
  assert.equal(listCalls(), before, 'the scraper must not be called for Stickers');
});

test('the scraper library accepts the added genres', () => {
  require('../controllers/listController');
  const constants = require('app-store-scraper/lib/constants');
  assert.ok(Object.values(constants.category).includes(6026));
  assert.ok(Object.values(constants.category).includes(6027));
  assert.ok(!Object.values(constants.category).includes(6025));
});

test('GET /toplists with an empty category still returns the overall chart', async () => {
  const res = await fetch(`${server.base}/toplists?collection=topfreeapplications&category=&categoryName=&country=us`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).totalCount, 2);
});
