// GSR-13: all three reproducibility-log handlers named the download after
// logInfo["query"], a key none of them sets, so every log was served as
// "Reproducibility_Log_undefined" with no extension.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mockResponse, request } = require("./helpers/stubScraper");

require("../routes/searchRoutes");
const { downloadRelog } = require("../controllers/searchController");
const { downloadReviewsRelog } = require("../controllers/reviewsController");
const { downloadTopChartsRelog } = require("../controllers/listController");

function disposition(handler, query) {
    const res = mockResponse();
    handler(request(query), res);
    assert.equal(res.statusCode, 200);
    return res.getHeader("Content-Disposition");
}

test("relog filenames name the query and end in .txt", () => {
    assert.equal(
        disposition(downloadRelog, { query: "mental health", countryCode: "us", includePermissions: "false", totalCount: "3" }),
        'attachment; filename="Reproducibility_Log_mental%20health.txt"',
    );
    assert.equal(
        disposition(downloadReviewsRelog, { appId: "com.whatsapp", countryCode: "us", store: "Google Play Store", sorting: "RECENT" }),
        'attachment; filename="Reproducibility_Log_com.whatsapp_reviews.txt"',
    );
    assert.equal(
        disposition(downloadTopChartsRelog, { collection: "TOP_FREE", category: "SOCIAL", country: "us", totalCount: "5" }),
        'attachment; filename="Reproducibility_Log_TOP_FREE_SOCIAL_us.txt"',
    );
});

test("characters that would break the header are encoded", () => {
    assert.equal(
        disposition(downloadRelog, { query: 'a"b/cé', countryCode: "us", totalCount: "1" }),
        'attachment; filename="Reproducibility_Log_a%22b%2Fc%C3%A9.txt"',
    );
});
