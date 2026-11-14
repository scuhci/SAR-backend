// Run with: npm test
// The rows kept for a top chart's CSV download must be the rows that request
// was shown. app-store-scraper's list() is stubbed, so nothing reaches Apple.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const FEED_SIZE = 100;
const storePath = require.resolve("app-store-scraper");
require.cache[storePath] = {
  id: storePath,
  filename: storePath,
  loaded: true,
  exports: {
    ...require("app-store-scraper"),
    // Each row says which category and how many apps the scraper was asked for
    list: async (opts) =>
      Array.from({ length: Math.min(opts.num, FEED_SIZE) }, (_, i) => ({
        id: i + 1,
        appId: `cat${opts.category}.app${i + 1}`,
        title: `Chart category=${opts.category} #${i + 1}`,
      })),
  },
};

const { scrapeList, downloadTopChartsCSV } = require(
  path.join(__dirname, "..", "controllers", "listController.js")
);

console.log = () => {};

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.setHeader = () => res;
  res.getHeader = () => undefined;
  res.end = () => res;
  return res;
};

const scrape = async (query) => {
  const res = makeRes();
  await scrapeList({ query: { collection: "topfreeapplications", country: "US", ...query } }, res);
  assert.strictEqual(res.statusCode, 200);
  return res.body;
};

// Data rows of the CSV stored under a download query
const download = (query) => {
  const res = makeRes();
  downloadTopChartsCSV({ method: "GET", headers: {}, query: { query } }, res);
  assert.strictEqual(res.statusCode, 200, `download of ${query}`);
  return res.body.split("\n").slice(1);
};

// What the website sends: no num, and collection + category key + country to download
const SITE_GAMES = { category: "6014", categoryName: "GAMES" };
const SITE_GAMES_DOWNLOAD = "topfreeapplicationsGAMESUS";

test("the website's download query still finds the full chart", async () => {
  const shown = await scrape(SITE_GAMES);
  assert.strictEqual(shown.downloadQuery, SITE_GAMES_DOWNLOAD);
  assert.strictEqual(download(SITE_GAMES_DOWNLOAD).length, shown.totalCount);
});

test("a request for fewer apps does not replace the rows of the full chart", async () => {
  const shown = await scrape(SITE_GAMES);
  const short = await scrape({ ...SITE_GAMES, num: "5" });
  assert.strictEqual(short.totalCount, 5);

  assert.strictEqual(download(SITE_GAMES_DOWNLOAD).length, shown.totalCount);
  // the shorter list is kept under its own key, named in the response
  assert.notStrictEqual(short.downloadQuery, SITE_GAMES_DOWNLOAD);
  assert.strictEqual(download(short.downloadQuery).length, 5);
});

test("two short requests of different sizes do not overwrite each other", async () => {
  const six = await scrape({ ...SITE_GAMES, num: "6" });
  const two = await scrape({ ...SITE_GAMES, num: "2" });
  assert.strictEqual(download(six.downloadQuery).length, 6);
  assert.strictEqual(download(two.downloadQuery).length, 2);
});

test("a categoryName that does not match the category cannot replace another chart", async () => {
  // "No Category" as the website sends it
  await scrape({ category: "", categoryName: "" });
  // another client: Games code, but the name of the uncategorised chart
  const games = await scrape({ category: "6014", categoryName: "" });

  const uncategorised = download("topfreeapplicationsUS");
  assert.strictEqual(uncategorised.length, FEED_SIZE);
  assert.ok(!uncategorised.some((row) => row.includes("category=6014")));
  // the Games rows are under the Games key
  assert.strictEqual(games.downloadQuery, SITE_GAMES_DOWNLOAD);
  assert.ok(download(SITE_GAMES_DOWNLOAD)[0].includes("category=6014"));
});

test("charts requested without categoryName are stored per category", async () => {
  await scrape({ category: "6014" });
  const business = await scrape({ category: "6000" });
  assert.strictEqual(business.downloadQuery, "topfreeapplicationsBUSINESSUS");
  assert.ok(download(SITE_GAMES_DOWNLOAD)[0].includes("category=6014"));
  assert.ok(download("topfreeapplicationsBUSINESSUS")[0].includes("category=6000"));
});
