const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Stub app-store-scraper before the controller loads it; shouldThrow makes
// the review feed fail so a scrape ends in a 500.
const scraperPath = require.resolve("app-store-scraper");
let shouldThrow = false;
require.cache[scraperPath] = {
  id: scraperPath,
  filename: scraperPath,
  loaded: true,
  exports: {
    sort: { RECENT: "mostRecent", HELPFUL: "mostHelpful" },
    app: async () => ({ reviews: 1234 }),
    reviews: async (options) => {
      if (shouldThrow) throw new Error("simulated scrape failure");
      return options.page === 1
        ? [review("one"), review("two"), review("three")]
        : [];
    },
  },
};

const { scrapeReviews, downloadReviewsRelog } = require(path.join(
  __dirname,
  "..",
  "controllers",
  "reviewsController.js"
));

function review(id) {
  return {
    id,
    userName: "Reviewer " + id,
    userUrl: "https://example.invalid/user/" + id,
    version: "1.0",
    score: 5,
    title: "Review " + id,
    text: "Text " + id,
    url: "https://example.invalid/review/" + id,
    updated: "2026-01-01T00:00:00-07:00",
  };
}

const makeReq = (query) => ({ query, method: "GET", headers: {} });
const makeRes = () => {
  const res = { headers: {}, statusCode: 200, body: undefined };
  res.set = (key, value) => {
    res.headers[key.toLowerCase()] = value;
    return res;
  };
  res.setHeader = res.set;
  res.getHeader = (key) => res.headers[key.toLowerCase()];
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.json = res.send;
  res.end = () => res;
  return res;
};

async function scrape(appId, countryCode = "us", sortBy = "Recency") {
  const res = makeRes();
  await scrapeReviews(makeReq({ appId, countryCode, sortBy }), res);
  return res;
}

function relog(appId, countryCode = "us", sortBy) {
  const res = makeRes();
  downloadReviewsRelog(
    makeReq({ appId, countryCode, sortBy, store: "iOS App Store", sorting: "HELPFUL" }),
    res
  );
  return res;
}

const UNKNOWN = "unknown (no scrape recorded on this server)";

test("cold cache relog uses explicit unknown values", () => {
  const res = relog("cache-cold-unique");
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes("num_reviews: " + UNKNOWN));
  assert.ok(res.body.includes("total_ratings: " + UNKNOWN));
  assert.ok(res.body.includes("sort: " + UNKNOWN));
});

test("country codes are case-insensitive in the scrape cache", async () => {
  const res = await scrape("cache-country-case-unique", "us");
  assert.equal(res.statusCode, 200);
  const log = relog("cache-country-case-unique", "US").body;
  assert.match(log, /^num_reviews: 3$/m);
  assert.match(log, /^total_ratings: 1234$/m);
  assert.match(log, /^sort: mostRecent$/m);
});

test("a failed scrape clears the prior successful cache record", async () => {
  const appId = "cache-failed-scrape-unique";
  assert.equal((await scrape(appId)).statusCode, 200);
  shouldThrow = true;
  const failed = await scrape(appId);
  shouldThrow = false;
  assert.equal(failed.statusCode, 500);
  const log = relog(appId).body;
  assert.ok(log.includes("num_reviews: " + UNKNOWN));
});

test("cache records are separated by resolved sort", async () => {
  const appId = "cache-sort-unique";
  assert.equal((await scrape(appId, "us", "Recency")).statusCode, 200);
  assert.equal((await scrape(appId, "us", "Helpfulness")).statusCode, 200);
  assert.match(relog(appId).body, /^sort: mostRecent$/m);
  assert.match(relog(appId, "us", "Helpfulness").body, /^sort: mostHelpful$/m);
});

test("relog date_time remains the original scrape time", async () => {
  const appId = "cache-scrape-time-unique";
  assert.equal((await scrape(appId)).statusCode, 200);
  const first = relog(appId).body.match(/^date_time: .*$/m)[0];
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const second = relog(appId).body.match(/^date_time: .*$/m)[0];
  assert.equal(second, first);
});
