// GSR-11: jsonToCsv stripped "HTML tags" from every cell, so any text between
// a "<" and the next ">" vanished: "battery < 20% and > 10%" became
// "battery  10%". HTML is now stripped once, in the controllers, and only
// from the fields that are HTML.
const test = require("node:test");
const assert = require("node:assert/strict");
const { STORE_APP, mockResponse, request, csvTable } = require("./helpers/stubScraper");
const { htmlToText } = require("../utilities/jsonToCsv");

require("../routes/searchRoutes");
const searchController = require("../controllers/searchController");
const { scrapeReviews } = require("../controllers/reviewsController");

test("review text with < and > is exported verbatim", async () => {
    const res = mockResponse();
    await scrapeReviews(request({ appId: STORE_APP.appId, countryCode: "us" }), res);
    assert.equal(res.statusCode, 200);
    const [row] = csvTable(res.body).rows;
    assert.equal(row.reviewText, 'battery < 20% and > 10%, "drains" fast help');
});

test("escaped < and > in a description survive into the CSV", async () => {
    STORE_APP.summary = "<p>Battery &lt; 20% and &gt; 10%</p> &lt;3 &amp;lt;b&amp;gt;";
    const query = { query: "quote", countryCode: "us", includePermissions: "false" };
    const searchRes = mockResponse();
    await searchController.search(request(query), searchRes);
    const expected = "Battery < 20% and > 10% <3 &lt;b&gt;";
    assert.equal(searchRes.body.results[0].summary, expected);

    const csvRes = mockResponse();
    searchController.downloadCSV(request(query), csvRes);
    assert.equal(csvTable(csvRes.body).rows[0].description, expected);
});

test("htmlToText removes tags and decodes entities once", () => {
    assert.equal(htmlToText("Bug fixes<br/>Speed &amp; <b>stability</b>"), "Bug fixes Speed & stability");
    assert.equal(htmlToText("a\r\nb"), "a b");
    assert.equal(htmlToText(null), null);
});
