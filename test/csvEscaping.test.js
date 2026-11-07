// GSR-05: summary and recentChanges were quote-escaped in the controller and
// again in jsonToCsv, so `Say "hi"` reached the CSV as `Say """"hi""""`.
const test = require("node:test");
const assert = require("node:assert/strict");
const { SUMMARY, RECENT_CHANGES, mockResponse, request, csvTable } = require("./helpers/stubScraper");

// same load order as index.js (the router and searchController require each other)
require("../routes/searchRoutes");
const searchController = require("../controllers/searchController");
const listController = require("../controllers/listController");

for (const includePermissions of ["false", "true"]) {
    test(`search (includePermissions=${includePermissions}): website and CSV get the text escaped once`, async () => {
        const query = { query: "quote", countryCode: "us", includePermissions };

        const searchRes = mockResponse();
        await searchController.search(request(query), searchRes);
        assert.equal(searchRes.statusCode, 200);
        const [result] = searchRes.body.results;
        assert.equal(result.summary, SUMMARY);
        assert.equal(result.recentChanges, RECENT_CHANGES);

        const csvRes = mockResponse();
        searchController.downloadCSV(request(query), csvRes);
        assert.equal(csvRes.statusCode, 200);
        const [row] = csvTable(csvRes.body).rows;
        assert.equal(row.description, SUMMARY);
        assert.equal(row.currentVersionChanges, RECENT_CHANGES);
    });
}

test("top charts: website and CSV get the text escaped once", async () => {
    const listRes = mockResponse();
    await listController.scrapeList(request({ collection: "TOP_FREE", category: "GAME", country: "us" }), listRes);
    assert.equal(listRes.statusCode, 200);
    const [result] = listRes.body.results;
    assert.equal(result.summary, SUMMARY);
    assert.equal(result.recentChanges, RECENT_CHANGES);

    const csvRes = mockResponse();
    listController.downloadTopChartsCSV(request({ query: "TOP_FREEGAMEus", includePermissions: "false" }), csvRes);
    assert.equal(csvRes.statusCode, 200);
    const [row] = csvTable(csvRes.body).rows;
    assert.equal(row.description, SUMMARY);
    assert.equal(row.currentVersionChanges, RECENT_CHANGES);
});
