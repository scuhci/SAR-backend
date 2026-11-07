const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// Stub app-store-scraper before the controller loads it so no live store traffic happens.
const scraperPath = require.resolve("app-store-scraper");
const TOTAL_RATINGS = 29683743;
const scraperCalls = [];
const fakeReview = (id, score) => ({
  id,
  userName: "user" + id,
  userUrl: "https://example.invalid/" + id,
  version: "1.0",
  score,
  title: "title",
  text: "review " + id,
  url: "https://example.invalid/review/" + id,
  updated: "2026-01-01T00:00:00-07:00",
});
require.cache[scraperPath] = {
  id: scraperPath,
  filename: scraperPath,
  loaded: true,
  exports: {
    sort: { RECENT: "mostRecent", HELPFUL: "mostHelpful" },
    app: async () => ({ id: 389801252, reviews: TOTAL_RATINGS }),
    reviews: async (opts) => {
      scraperCalls.push({ page: opts.page, sort: opts.sort });
      return opts.page === 1 ? [fakeReview("1", 5), fakeReview("2", 1)] : [];
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
  res.set = (k, v) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.setHeader = res.set;
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (body) => {
    res.body = body;
    return res;
  };
  res.json = res.send;
  res.end = () => res;
  return res;
};

const sortsUsed = () => [...new Set(scraperCalls.map((c) => c.sort))];

const scrape = async (sortBy) => {
  scraperCalls.length = 0;
  const res = makeRes();
  await scrapeReviews(
    makeReq({ appId: "com.burbn.instagram", countryCode: "us", sortBy }),
    res
  );
  assert.equal(res.statusCode, 200);
  return res;
};

const relog = () => {
  const res = makeRes();
  downloadReviewsRelog(
    makeReq({
      appId: "com.burbn.instagram",
      countryCode: "us",
      store: "iOS App Store",
      sorting: "RECENT", // what the frontend always sends, regardless of the scrape
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  return res.body;
};

test("sortBy=Helpfulness is passed to the scraper and recorded in the relog", async () => {
  const csv = await scrape("Helpfulness");
  assert.deepEqual(sortsUsed(), ["mostHelpful"]);
  assert.equal(csv.body.split("\n").length - 1, 2, "two review rows delivered");

  const log = relog();
  assert.match(log, /^num_reviews: 2$/m);
  assert.match(log, new RegExp(`^total_ratings: ${TOTAL_RATINGS}$`, "m"));
  assert.match(log, /^sort: mostHelpful$/m);
  assert.doesNotMatch(log, new RegExp(`^num_reviews: ${TOTAL_RATINGS}$`, "m"));
});

test("sortBy=Recency uses the most-recent feed and the relog says so", async () => {
  await scrape("Recency");
  assert.deepEqual(sortsUsed(), ["mostRecent"]);
  assert.match(relog(), /^sort: mostRecent$/m);
});

test("the frontend's RECENT/HELPFUL constants are accepted too", async () => {
  await scrape("HELPFUL");
  assert.deepEqual(sortsUsed(), ["mostHelpful"]);
  await scrape("RECENT");
  assert.deepEqual(sortsUsed(), ["mostRecent"]);
});

test("a sort Apple does not offer falls back to RECENT and the relog records mostRecent", async () => {
  await scrape("Rating");
  assert.deepEqual(sortsUsed(), ["mostRecent"]);
  assert.match(relog(), /^sort: mostRecent$/m);

  await scrape(undefined);
  assert.deepEqual(sortsUsed(), ["mostRecent"]);
  assert.match(relog(), /^sort: mostRecent$/m);
});
