// Run with: npm test
// The stores behind /toplists and /search must stay bounded however many
// distinct charts or searches are requested. app-store-scraper is stubbed.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { DEFAULT_MAX_ENTRIES } = require("../utilities/resultCache");

const storePath = require.resolve("app-store-scraper");
const realStore = require("app-store-scraper");
require.cache[storePath] = {
  id: storePath,
  filename: storePath,
  loaded: true,
  exports: {
    ...realStore,
    list: async () => [{ id: 1, appId: "com.example.one", title: "One" }],
    search: async ({ term }) => [{ id: 1, appId: `com.example.${term}`, title: term }],
    app: async () => { throw new Error("App not found (404)"); },
    similar: async () => [],
  },
};

require(path.join(__dirname, "..", "routes", "searchRoutes"));
const searchController = require(path.join(__dirname, "..", "controllers", "searchController"));
const { scrapeList, downloadTopChartsCSV } = require(
  path.join(__dirname, "..", "controllers", "listController")
);
if (searchController.lookupThrottle) {
  searchController.lookupThrottle.spacingMs = 0;
}

console.log = () => {};
console.error = () => {};

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.set = () => res;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.setHeader = () => res;
  res.getHeader = () => undefined;
  res.end = () => res;
  return res;
};

const countries = Object.keys(realStore.markets).slice(0, DEFAULT_MAX_ENTRIES + 5);

test("top chart store drops the oldest chart once the cap is reached", async () => {
  const keys = [];
  for (const country of countries) {
    const res = makeRes();
    await scrapeList({ query: { collection: "topfreeapplications", category: "6014", country } }, res);
    assert.strictEqual(res.statusCode, 200);
    keys.push(res.body.downloadQuery);
  }
  const download = (query) => {
    const res = makeRes();
    downloadTopChartsCSV({ method: "GET", headers: {}, query: { query } }, res);
    return res.statusCode;
  };
  // the newest charts are still downloadable, the first ones answer 404
  assert.strictEqual(download(keys[keys.length - 1]), 200);
  assert.strictEqual(download(keys[5]), 200);
  assert.strictEqual(download(keys[4]), 404);
  assert.strictEqual(download(keys[0]), 404);
});

test("search store drops the oldest search once the cap is reached", async () => {
  const terms = countries.map((_, i) => `term${i}`);
  for (const term of terms) {
    const res = makeRes();
    await searchController.search({ query: { query: term, countryCode: "us" } }, res);
    assert.strictEqual(res.statusCode, 200);
  }
  const download = (query) => {
    const res = makeRes();
    searchController.downloadCSV({ method: "GET", headers: {}, query: { query, countryCode: "us" } }, res);
    return res.statusCode;
  };
  assert.strictEqual(download(terms[terms.length - 1]), 200);
  assert.strictEqual(download(terms[5]), 200);
  assert.strictEqual(download(terms[4]), 404);
  assert.strictEqual(download(terms[0]), 404);
});
