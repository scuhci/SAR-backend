// GSR-14: dateScraped was written unquoted in the server's local time zone,
// null/undefined fields came out as the words "null"/"undefined", records
// were LF-separated, and /download-csv sent two Content-Type headers.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mockResponse, request, csvTable } = require("./helpers/stubScraper");
const { jsonToCsv } = require("../utilities/jsonToCsv");
const standardPermissionsList = require("../controllers/permissionsConfig");

require("../routes/searchRoutes");
const searchController = require("../controllers/searchController");

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("null and undefined fields are empty cells", () => {
    const csv = jsonToCsv(
        [{ id: "r1", date: null, text: undefined, replyText: null, thumbsUp: 0, country: "us" }],
        "reviews",
    );
    assert.ok(!/null|undefined/.test(csv), csv);
    const [row] = csvTable(csv).rows;
    assert.equal(row.dateReviewed, "");
    assert.equal(row.reviewText, "");
    assert.equal(row.developerReplyText, "");
    assert.equal(row.helpfulVotes, "0");
});

test("dateScraped is a quoted ISO-8601 UTC timestamp", () => {
    const csv = jsonToCsv([{ title: "A", appId: "a.b" }], "app", standardPermissionsList, false);
    const record = csv.split("\r\n")[1];
    const cell = record.slice(record.lastIndexOf(",") + 1);
    assert.match(cell, /^".*"$/);
    assert.match(csvTable(csv).rows[0].dateScraped, ISO_UTC);
});

test("Date and object values are written in a readable form", () => {
    const csv = jsonToCsv(
        [{ id: "r1", date: new Date("2026-01-02T03:04:05Z"), score: 5, extra: { a: 1 } }],
        "reviews",
    );
    const [row] = csvTable(csv).rows;
    assert.equal(row.dateReviewed, "2026-01-02T03:04:05.000Z");
    assert.equal(row.extra, '{"a":1}');
});

test("records are CRLF-separated and the file parses as RFC 4180", () => {
    const csv = jsonToCsv(
        [
            { title: 'Comma, "quote"', appId: "a.b", summary: "line one\nline two", permissions: [] },
            { title: "Second", appId: "c.d", summary: "Ünïcödé ✓", permissions: [{ permission: standardPermissionsList[0] }] },
        ],
        "app",
        standardPermissionsList,
        true,
    );
    assert.ok(!/[^\r]\n/.test(csv), "every line break is CRLF");
    const { header, rows } = csvTable(csv);
    assert.equal(header.length, 3 + 1 + standardPermissionsList.length);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].appName, 'Comma, "quote"');
    assert.equal(rows[0].description, "line one line two");
    assert.equal(rows[1].description, "Ünïcödé ✓");
    assert.equal(rows[0][standardPermissionsList[0]], "false");
    assert.equal(rows[1][standardPermissionsList[0]], "true");
});

test("/download-csv sends one Content-Type header with the charset", async () => {
    const query = { query: "quote", countryCode: "us", includePermissions: "false" };
    await searchController.search(request(query), mockResponse());
    const res = mockResponse();
    searchController.downloadCSV(request(query), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.getHeader("Content-Type"), "text/csv; charset=utf-8");
});
