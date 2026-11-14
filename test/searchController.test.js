// Run with: npm test
// app-store-scraper is replaced with an in-memory stub before the controller
// loads, so these tests never reach the App Store.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

// Fake store: 3 primary results, each with related apps that overlap.
const primary = [
  { id: 101, appId: "com.example.one", title: "One" },
  { id: 102, appId: "com.example.two", title: "Two" },
  { id: 103, appId: "com.example.three", title: "Three" },
];
const similarByAppId = {
  "com.example.one": ["com.example.sim1", "com.example.sim2", "com.example.sim3"],
  "com.example.two": ["com.example.sim2", "com.example.sim4", "com.example.sim5"],
  "com.example.three": ["com.example.sim3", "com.example.sim5", "com.example.sim6"],
};
const appIdById = Object.fromEntries(primary.map((a) => [a.id, a.appId]));

const calls = { search: [], app: [], similar: [] };
let storeCallStarts = [];
let failingAppIds = new Set();
let failingSimilar = new Set();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Records the start time of every throttled store call.
async function storeCall(fn) {
  storeCallStarts.push(Date.now());
  await delay(5);
  return fn();
}

const stub = {
  search: async (opts) => {
    calls.search.push(opts);
    return primary.map((a) => ({ ...a }));
  },
  // similar() accepts either the numeric id or the bundle id, like the library.
  similar: (opts) =>
    storeCall(() => {
      calls.similar.push(opts);
      const appId = opts.id !== undefined ? appIdById[opts.id] : opts.appId;
      if (failingSimilar.has(appId)) {
        throw new Error("similar failed");
      }
      return (similarByAppId[appId] || []).map((simId) => ({
        appId: simId,
        title: simId.split(".").pop(),
      }));
    }),
  app: async (opts) => {
    // The controller first probes the query itself as an app ID; that must fail
    // for a keyword search and is not part of the throttled expansion.
    if (opts.appId === "keyword") {
      throw new Error("App not found (404)");
    }
    return storeCall(() => {
      calls.app.push(opts);
      if (failingAppIds.has(opts.appId)) {
        throw new Error("App not found (404)");
      }
      return { appId: opts.appId, title: opts.appId, description: "d", genre: "g" };
    });
  },
};
const storePath = require.resolve("app-store-scraper");
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: stub };

// routes/searchRoutes and controllers/searchController require each other;
// load the router first, the same order index.js uses.
require(path.join(__dirname, "..", "routes", "searchRoutes"));
const { search, lookupThrottle } = require(path.join(__dirname, "..", "controllers", "searchController"));
// Short spacing keeps the suite fast; the limits themselves are covered with
// mock timers in test/throttle.test.js.
const DEFAULT_LIMITS = { ...lookupThrottle };
const TEST_SPACING_MS = 20;
lookupThrottle.spacingMs = TEST_SPACING_MS;

console.log = () => {};
console.error = () => {};

function makeReq(extraQuery = {}) {
  return { query: { query: "keyword", countryCode: "us", ...extraQuery } };
}

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.set = () => res;
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
  calls.search.length = 0;
  calls.app.length = 0;
  calls.similar.length = 0;
  storeCallStarts = [];
  failingAppIds = new Set();
  failingSimilar = new Set();
});

test("production lookup limits are 4 in flight and 250 ms between starts", () => {
  assert.deepStrictEqual(DEFAULT_LIMITS, { concurrency: 4, spacingMs: 250 });
});

test("keyword search has no per-result sleep, stays throttled and looks each app up once", async () => {
  const res = makeRes();
  const started = Date.now();
  await search(makeReq(), res);
  const elapsed = Date.now() - started;

  assert.strictEqual(res.statusCode, 200);
  // Old code slept 3 s after each of the 3 primary results (>= 9 s).
  assert.ok(elapsed < 3000, `took ${elapsed} ms`);
  // Store calls go through the throttle, so their starts are spaced out
  // (2 ms of slack for timer rounding).
  const starts = [...storeCallStarts].sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) {
    assert.ok(
      starts[i] - starts[i - 1] >= TEST_SPACING_MS - 2,
      `calls ${i - 1} and ${i} started ${starts[i] - starts[i - 1]} ms apart`
    );
  }
  // 3 primary + 6 unique related apps; duplicates across lists are fetched once.
  assert.strictEqual(calls.similar.length, 3);
  assert.strictEqual(calls.app.length, 9);
  assert.strictEqual(res.body.totalCount, 9);
  assert.strictEqual(res.body.partial, false);
  assert.deepStrictEqual(res.body.failedAppIds, []);
  assert.deepStrictEqual(res.body.relatedFailedFor, []);
});

test("failed lookups are reported in the response instead of silently dropped", async () => {
  failingAppIds = new Set(["com.example.sim2", "com.example.three"]);
  failingSimilar = new Set(["com.example.two"]);
  const res = makeRes();
  await search(makeReq(), res);

  assert.strictEqual(res.statusCode, 200);
  // "two" has no related list, so sim4 is never found; sim2 and three fail lookup.
  const returned = res.body.results.map((r) => r.appId).sort();
  assert.deepStrictEqual(returned, [
    "com.example.one",
    "com.example.sim1",
    "com.example.sim3",
    "com.example.sim5",
    "com.example.sim6",
    "com.example.two",
  ]);
  assert.strictEqual(res.body.partial, true);
  assert.deepStrictEqual([...res.body.failedAppIds].sort(), ["com.example.sim2", "com.example.three"]);
  assert.deepStrictEqual(res.body.relatedFailedFor, ["com.example.two"]);
});

test("related apps are fetched from the storefront the user selected", async () => {
  const res = makeRes();
  await search(makeReq({ countryCode: "gb" }), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.similar.length, 3);
  for (const call of calls.similar) {
    assert.strictEqual(call.country, "gb", "similar() must receive the requested country");
    // The numeric id saves similar() an extra bundle-id lookup per primary result.
    assert.ok(appIdById[call.id], `similar() called without a numeric id: ${JSON.stringify(call)}`);
  }
  const related = res.body.results.filter((r) => r.source === "related app");
  assert.strictEqual(related.length, 6);
  assert.ok(related.every((r) => r.country === "gb"));
});
