// Cached CSVs were stamped with the download time, so repeated downloads could
// show different scrape dates even though the underlying cached results were unchanged.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mockResponse, request, csvTable } = require("./helpers/stubScraper");

require("../routes/searchRoutes");
const searchController = require("../controllers/searchController");
const listController = require("../controllers/listController");

const SCRAPE_TIME = "2026-11-10T09:00:00.000Z";
const SCRAPE_MILLIS = Date.parse(SCRAPE_TIME);

function assertScrapedAt(res) {
    assert.equal(res.statusCode, 200);
    const { rows } = csvTable(res.body);
    assert.ok(rows.length > 0);
    for (const row of rows) assert.equal(row.dateScraped, SCRAPE_TIME);
}

test("keyword search downloads keep the original scrape time", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(SCRAPE_TIME) });

    await searchController.search(
        request({ query: "quote", countryCode: "us", includePermissions: "false" }),
        mockResponse(),
    );

    const immediate = mockResponse();
    searchController.downloadCSV(
        request({ query: "quote", countryCode: "us", includePermissions: "false" }),
        immediate,
    );
    assertScrapedAt(immediate);

    for (const days of [3, 6]) {
        t.mock.timers.setTime(SCRAPE_MILLIS + days * 24 * 60 * 60 * 1000);
        const later = mockResponse();
        searchController.downloadCSV(
            request({ query: "quote", countryCode: "us", includePermissions: "false" }),
            later,
        );
        assertScrapedAt(later);
    }
});

test("top charts CSV keeps the original scrape time", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(SCRAPE_TIME) });

    await listController.scrapeList(
        request({ collection: "TOP_FREE", category: "TOOLS", country: "us", includePermissions: "false" }),
        mockResponse(),
    );

    t.mock.timers.setTime(SCRAPE_MILLIS + 3 * 24 * 60 * 60 * 1000);
    const res = mockResponse();
    listController.downloadTopChartsCSV(
        request({ query: "TOP_FREETOOLSus", includePermissions: "false" }),
        res,
    );
    assertScrapedAt(res);
});
