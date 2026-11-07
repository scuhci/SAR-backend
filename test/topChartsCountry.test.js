// Run with: npm test   (node --test, no extra dependencies)
// app-store-scraper is replaced with a stub before the controller loads, so
// these tests never hit the App Store.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const realStore = require("app-store-scraper");
const stub = {
  ...realStore,
  list: async () => [
    { id: 1, appId: "com.example.one", title: "Stub App One", score: 4.5 },
    { id: 2, appId: "com.example.two", title: "Stub App Two", score: 3.0 },
  ],
};
const storePath = require.resolve("app-store-scraper");
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: stub };

const { scrapeList, downloadTopChartsCSV } = require(
  path.join(__dirname, "..", "controllers", "listController.js")
);

const makeRes = () => {
  const headers = {};
  const res = { statusCode: 200, body: undefined, headers };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.setHeader = (k, v) => { headers[k.toLowerCase()] = v; return res; };
  res.getHeader = (k) => headers[k.toLowerCase()];
  res.end = () => res;
  return res;
};

const listQuery = {
  collection: "topfreeapplications",
  category: "6005",
  categoryName: "Social Networking",
  country: "gb",
};
const cacheKey = listQuery.collection + listQuery.categoryName + listQuery.country;

test("toplists JSON rows carry the requested country and collection", async () => {
  const res = makeRes();
  await scrapeList({ query: listQuery }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.totalCount, 2);
  for (const row of res.body.results) {
    assert.strictEqual(row.country, "gb");
    assert.strictEqual(row.collection, "topfreeapplications");
  }
  // existing fields are untouched
  assert.strictEqual(res.body.results[0].title, "Stub App One");
});

test("top charts CSV has country and collection columns filled on every row", async () => {
  const listRes = makeRes();
  await scrapeList({ query: listQuery }, listRes);

  const csvRes = makeRes();
  downloadTopChartsCSV(
    { method: "GET", headers: {}, query: { query: cacheKey } },
    csvRes
  );
  assert.strictEqual(csvRes.statusCode, 200);
  const lines = csvRes.body.split("\n");
  const header = lines[0].split(",");
  const countryIdx = header.indexOf('"country"');
  const collectionIdx = header.indexOf('"collection"');
  assert.notStrictEqual(countryIdx, -1, "CSV header is missing country");
  assert.notStrictEqual(collectionIdx, -1, "CSV header is missing collection");
  assert.strictEqual(lines.length, 3); // header + 2 rows
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    assert.strictEqual(cells[countryIdx], '"gb"');
    assert.strictEqual(cells[collectionIdx], '"topfreeapplications"');
  }
});
