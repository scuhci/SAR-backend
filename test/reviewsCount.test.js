const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Stub app-store-scraper before the controller loads it. Each test sets the
// app's rating count and the review feed pages; pages past the end are empty.
const scraperPath = require.resolve("app-store-scraper");
let appReviews = 0;
let pages = [];
const pagesRequested = [];
require.cache[scraperPath] = {
  id: scraperPath,
  filename: scraperPath,
  loaded: true,
  exports: {
    sort: { RECENT: "mostRecent", HELPFUL: "mostHelpful" },
    app: async () => ({ reviews: appReviews }),
    reviews: async (options) => {
      pagesRequested.push(options.page);
      return pages[options.page - 1] || [];
    },
  },
};

const { scrapeReviews, downloadReviewsRelog } = require(path.join(
  __dirname,
  "..",
  "controllers",
  "reviewsController.js"
));

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

const review = (id) => ({
  id: String(id),
  userName: `Reviewer ${id}`,
  userUrl: `https://example.invalid/user/${id}`,
  version: "1.0",
  score: 5,
  title: `Review ${id}`,
  text: `Text ${id}`,
  url: `https://example.invalid/review/${id}`,
  updated: "2026-01-01T00:00:00-07:00",
});

const makeReviews = (start, count) =>
  Array.from({ length: count }, (_, index) => review(start + index));

const runScrape = async (appId, ratings, feedPages) => {
  appReviews = ratings;
  pages = feedPages;
  pagesRequested.length = 0;
  const res = makeRes();
  await scrapeReviews(makeReq({ appId, countryCode: "us" }), res);
  assert.equal(res.statusCode, 200);
  const logRes = makeRes();
  downloadReviewsRelog(
    makeReq({ appId, countryCode: "us", store: "iOS App Store" }),
    logRes
  );
  return { csv: res.body, log: logRes.body };
};

test("rating count below feed length does not cap reviews or relog ratings", async () => {
  const feed = [makeReviews(1, 50), makeReviews(51, 50), makeReviews(101, 50), makeReviews(151, 2)];
  const { csv, log } = await runScrape("count-low-feed", 99, feed);
  const rows = csv.trimEnd().split("\n").slice(1);
  assert.equal(rows.length, 152);
  assert.equal(new Set(rows.map((row) => row.split(",")[0])).size, 152);
  assert.match(log, /^num_reviews: 152$/m);
  assert.match(log, /^total_ratings: 99$/m);
  assert.deepEqual(pagesRequested, [1, 2, 3, 4, 5, 6]);
});

test("duplicate ids across pages appear once in the CSV", async () => {
  const { csv, log } = await runScrape("duplicate-feed", 0, [
    [review(1001), review(1002), review(1003)],
    [review(1003), review(1004)],
  ]);
  const ids = csv
    .trimEnd()
    .split("\n")
    .slice(1)
    .map((row) => row.split(",")[0].replace(/"/g, ""));
  assert.deepEqual(ids, ["1001", "1002", "1003", "1004"]);
  assert.match(log, /^num_reviews: 4$/m);
});

test("rating count above feed length still returns the available feed", async () => {
  const feed = [makeReviews(2001, 50), makeReviews(2051, 50), makeReviews(2101, 50), makeReviews(2151, 2)];
  const { csv } = await runScrape("count-high-feed", 10000, feed);
  assert.equal(csv.trimEnd().split("\n").length - 1, 152);
});
