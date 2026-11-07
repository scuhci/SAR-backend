const test = require("node:test");
const assert = require("node:assert");

// searchController and routes/searchRoutes require each other; index.js loads
// the routes first, so do the same here to avoid a half-built module.
require("../routes/searchRoutes");
const { downloadRelog } = require("../controllers/searchController");
const { downloadReviewsRelog } = require("../controllers/reviewsController");
const { downloadTopChartsRelog } = require("../controllers/listController");

// Calls a relog handler with a fake request/response and returns the headers
// and body it produced. No scraper calls are involved in these handlers.
function callRelog(handler, query) {
  const headers = {};
  let body;
  let statusCode = 200;
  const req = { method: "GET", headers: {}, query };
  const res = {
    setHeader: (name, value) => {
      headers[name.toLowerCase()] = value;
    },
    getHeader: (name) => headers[name.toLowerCase()],
    status: (code) => {
      statusCode = code;
      return res;
    },
    send: (text) => {
      body = text;
      return res;
    },
    end: () => res,
  };
  handler(req, res);
  return { headers, body, statusCode };
}

function filenameOf(headers) {
  const match = /filename="([^"]*)"/.exec(headers["content-disposition"]);
  return match && match[1];
}

test("keyword search relog is named after the search term", () => {
  const { headers, statusCode } = callRelog(downloadRelog, {
    query: "zzqqxx",
    countryCode: "us",
    store: "iOS App Store",
    totalCount: "1",
  });
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(filenameOf(headers), "Reproducibility_Log_zzqqxx.txt");
});

test("search relog filename is header-safe for queries with spaces and quotes", () => {
  const { headers, statusCode } = callRelog(downloadRelog, {
    query: 'sleep "tracker" app',
    countryCode: "us",
    store: "iOS App Store",
    totalCount: "3",
  });
  assert.strictEqual(statusCode, 200);
  const filename = filenameOf(headers);
  assert.strictEqual(
    filename,
    "Reproducibility_Log_sleep%20%22tracker%22%20app.txt"
  );
  assert.strictEqual(decodeURI(filename), 'Reproducibility_Log_sleep "tracker" app.txt');
});

test("reviews relog is named after the app id", () => {
  const { headers, body, statusCode } = callRelog(downloadReviewsRelog, {
    appId: "284882215",
    countryCode: "us",
    store: "iOS App Store",
    sorting: "RECENT",
  });
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(filenameOf(headers), "Reproducibility_Log_284882215.txt");
  assert.match(body, /^appId: 284882215$/m);
});

test("top charts relog is named after the collection and category", () => {
  const { headers, statusCode } = callRelog(downloadTopChartsRelog, {
    collection: "topfreeapplications",
    category: "6014",
    country: "us",
    device: "iPhone",
    totalCount: "5",
  });
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(
    filenameOf(headers),
    "Reproducibility_Log_topfreeapplications_6014.txt"
  );
});

test("top charts relog without a category still names the collection", () => {
  const { headers } = callRelog(downloadTopChartsRelog, {
    collection: "toppaidapplications",
    country: "us",
    device: "iPad",
    totalCount: "5",
  });
  assert.strictEqual(
    filenameOf(headers),
    "Reproducibility_Log_toppaidapplications.txt"
  );
});

test("no relog filename contains 'undefined'", () => {
  for (const [handler, query] of [
    [downloadRelog, { query: "zzqqxx", countryCode: "us" }],
    [downloadReviewsRelog, { appId: "284882215", countryCode: "us" }],
    [downloadTopChartsRelog, { collection: "topfreeapplications", country: "us" }],
  ]) {
    const { headers } = callRelog(handler, query);
    assert.doesNotMatch(filenameOf(headers), /undefined/);
  }
});
