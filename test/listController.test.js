// Run with: npm test
// Stubs app-store-scraper so no store traffic happens.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const MAX_APPS_COUNT = 200;

// Replace the real scraper module before the controller requires it.
const listCalls = [];
let listImpl = async (opts) => {
  listCalls.push(opts);
  if (opts.num === 1) {
    // Mirror the real library: Apple's RSS returns a single object (not an
    // array) at limit=1 and app-store-scraper then fails on apps.map.
    throw new TypeError("apps.map is not a function");
  }
  return Array.from({ length: opts.num }, (_, i) => ({
    id: String(1000 + i),
    title: `App ${i + 1}`,
  }));
};
require.cache[require.resolve("app-store-scraper")] = {
  id: require.resolve("app-store-scraper"),
  filename: require.resolve("app-store-scraper"),
  loaded: true,
  exports: {
    list: (opts) => listImpl(opts),
  },
};

const { scrapeList } = require(path.join(__dirname, "..", "controllers", "listController"));

// Keep the test output readable.
console.log = () => {};

function makeReq(extraQuery = {}) {
  return {
    query: {
      collection: "topfreeapplications",
      category: "6005",
      categoryName: "Social Networking",
      country: "us",
      ...extraQuery,
    },
  };
}

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

beforeEach(() => {
  listCalls.length = 0;
});

test("passes num to the scraper and returns that many apps", async () => {
  const res = makeRes();
  await scrapeList(makeReq({ num: "10" }), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(listCalls.length, 1);
  assert.strictEqual(listCalls[0].num, 10);
  assert.strictEqual(res.body.totalCount, 10);
  assert.strictEqual(res.body.results.length, 10);
});

test("num=1 asks the scraper for 2 and returns exactly 1 app", async () => {
  const res = makeRes();
  await scrapeList(makeReq({ num: "1" }), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(listCalls.length, 1);
  assert.strictEqual(listCalls[0].num, 2);
  assert.strictEqual(res.body.totalCount, 1);
  assert.strictEqual(res.body.results.length, 1);
  assert.strictEqual(res.body.results[0].title, "App 1");
});

test("requests the maximum when num is omitted", async () => {
  const res = makeRes();
  await scrapeList(makeReq(), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(listCalls[0].num, MAX_APPS_COUNT);
  assert.strictEqual(res.body.totalCount, MAX_APPS_COUNT);
});

test("clamps num above the maximum", async () => {
  const res = makeRes();
  await scrapeList(makeReq({ num: "500" }), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(listCalls[0].num, MAX_APPS_COUNT);
});

test("falls back to the maximum when num is not a positive integer", async () => {
  for (const bad of ["abc", "0", "-5"]) {
    listCalls.length = 0;
    const res = makeRes();
    await scrapeList(makeReq({ num: bad }), res);

    assert.strictEqual(res.statusCode, 200, `num=${bad}`);
    assert.strictEqual(listCalls[0].num, MAX_APPS_COUNT, `num=${bad}`);
  }
});

test("trims the result if the scraper returns more than requested", async () => {
  const original = listImpl;
  listImpl = async () =>
    Array.from({ length: 60 }, (_, i) => ({ id: String(i), title: `App ${i}` }));
  try {
    const res = makeRes();
    await scrapeList(makeReq({ num: "25" }), res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.totalCount, 25);
  } finally {
    listImpl = original;
  }
});
