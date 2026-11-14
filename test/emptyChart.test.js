// Run with: npm test
// Exercise the real app-store-scraper while stubbing only its HTTP dependency.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const scraperPath = require.resolve("app-store-scraper");
const requestPath = require.resolve("request", {
  paths: [path.dirname(scraperPath)],
});

const entry = (id) => ({
  id: { attributes: { "im:id": String(id), "im:bundleId": `com.example.app${id}` } },
});

const lookupResults = [
  { kind: "software", trackId: 1, bundleId: "com.example.app1", trackName: "App One" },
  { kind: "software", trackId: 2, bundleId: "com.example.app2", trackName: "App Two" },
];

const requestStub = (options, callback) => {
  const url = options.url;
  let statusCode = 200;
  let body;

  if (url.includes("/RSS/topmacapps/")) {
    body = JSON.stringify({
      feed: { author: {}, updated: {}, rights: {}, title: {}, icon: {}, link: [], id: {} },
    });
  } else if (url.includes("/RSS/topgrossingapplications/")) {
    statusCode = 500;
    body = "server error";
  } else if (url.includes("/RSS/")) {
    body = JSON.stringify({ feed: { entry: [entry(1), entry(2)] } });
  } else if (url.includes("/lookup?")) {
    body = JSON.stringify({ resultCount: 2, results: lookupResults });
  } else {
    statusCode = 500;
    body = "unexpected URL";
  }

  setImmediate(() => callback(null, { statusCode }, body));
};

require.cache[requestPath] = {
  id: requestPath,
  filename: requestPath,
  loaded: true,
  exports: requestStub,
};

const originalLog = console.log;
const originalError = console.error;
console.log = () => {};
console.error = () => {};

const { scrapeList } = require(path.join(__dirname, "..", "controllers", "listController.js"));

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

const makeReq = (collection) => ({
  query: { collection, category: "6014", categoryName: "GAMES", country: "US" },
});

test("a populated chart still returns its apps through the real scraper", async () => {
  const res = makeRes();
  await scrapeList(makeReq("topfreemacapps"), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.totalCount, 2);
});

test("a chart with no feed entries returns an empty result", async () => {
  const res = makeRes();
  await scrapeList(makeReq("topmacapps"), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.totalCount, 0);
  assert.deepStrictEqual(res.body.results, []);
});

test("other scraper failures still return an error", async () => {
  const res = makeRes();
  await scrapeList(makeReq("topgrossingapplications"), res);

  assert.strictEqual(res.statusCode, 500);
});

test.after(() => {
  console.log = originalLog;
  console.error = originalError;
});
