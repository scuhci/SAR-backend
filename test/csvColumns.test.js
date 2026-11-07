// GSR-09: the CSV header was built from Object.keys of the first row only, so
// the app-ID and keyword searches produced different column orders and a
// field missing from the first row was dropped for every row.
const test = require("node:test");
const assert = require("node:assert/strict");
const { STORE_APP, mockResponse, request, csvTable } = require("./helpers/stubScraper");
const { jsonToCsv } = require("../utilities/jsonToCsv");
const standardPermissionsList = require("../controllers/permissionsConfig");

require("../routes/searchRoutes");
const searchController = require("../controllers/searchController");
const listController = require("../controllers/listController");
const { scrapeReviews } = require("../controllers/reviewsController");

// Column order documented in the User Guide (frontend src/pages/UserGuide.jsx).
const APP_COLUMNS = [
    "appName", "appId", "url", "icon", "developer", "developerId", "currency", "price",
    "description", "avgRating", "country", "scrapedFrom", "approximateInstalls",
    "totalRatings", "totalReviews", "originalPrice", "discountEndDate", "downloadable",
    "inAppPurchases", "inAppPurchasesPriceRange", "androidMinVersion", "developerEmail",
    "developerWebsite", "developerAddress", "privacyPolicyURL", "genreId", "contentRating",
    "inAppAdvertisements", "originalReleaseDate", "currentAppVersion",
    "currentVersionChanges", "dateScraped",
];
const REVIEW_COLUMNS = [
    "reviewID", "dateReviewed", "rating", "reviewURL", "reviewText", "developerReplyDate",
    "developerReplyText", "versionWhenReviewed", "helpfulVotes", "country", "dateScraped",
];

async function searchHeader(query) {
    const params = { query, countryCode: "us", includePermissions: "false" };
    await searchController.search(request(params), mockResponse());
    const csvRes = mockResponse();
    searchController.downloadCSV(request(params), csvRes);
    return csvTable(csvRes.body).header;
}

test("keyword and app-ID searches produce the documented column order", async () => {
    assert.deepEqual(await searchHeader("quote"), APP_COLUMNS);
    assert.deepEqual(await searchHeader(STORE_APP.appId), APP_COLUMNS);
});

test("top charts use the same order (without the search-only columns)", async () => {
    await listController.scrapeList(request({ collection: "TOP_FREE", category: "GAME", country: "us" }), mockResponse());
    const csvRes = mockResponse();
    listController.downloadTopChartsCSV(request({ query: "TOP_FREEGAMEus", includePermissions: "false" }), csvRes);
    const { header } = csvTable(csvRes.body);
    assert.deepEqual(header, APP_COLUMNS.filter((column) => column !== "country" && column !== "scrapedFrom"));
});

test("reviews CSV uses the documented column order", async () => {
    const res = mockResponse();
    await scrapeReviews(request({ appId: STORE_APP.appId, countryCode: "us" }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(csvTable(res.body).header, REVIEW_COLUMNS);
});

test("a field missing from the first row is still exported for later rows", () => {
    const csv = jsonToCsv(
        [
            { title: "First", appId: "a.first" },
            { title: "Second", appId: "a.second", developerEmail: "dev@example.com" },
        ],
        "app",
        standardPermissionsList,
        false,
    );
    const { header, rows } = csvTable(csv);
    assert.deepEqual(header, ["appName", "appId", "developerEmail", "dateScraped"]);
    assert.equal(rows[0].developerEmail, "");
    assert.equal(rows[1].developerEmail, "dev@example.com");
});
