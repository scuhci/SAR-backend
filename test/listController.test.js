// Regression tests for the top-charts CSV cache. The scraper and the permissions
// lookup are stubbed, so no live store traffic. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const gplay = require("google-play-scraper");
const permissionsController = require("../controllers/permissionsController");
const { scrapeList, downloadTopChartsCSV } = require("../controllers/listController");

const makeApp = (i) => ({
    appId: "com.example.app" + i,
    title: "App " + i,
    summary: "summary " + i,
    score: 4.5,
    url: "https://play.google.com/store/apps/details?id=com.example.app" + i,
});

// gplay.list returns up to `num` canned apps; fetchPermissions tags each app with one permission.
gplay.list = async (options) => Array.from({ length: Math.min(options.num, 50) }, (_, i) => makeApp(i));
permissionsController.fetchPermissions = async (results) =>
    results.map((appInfo) => ({
        ...appInfo,
        permissions: [{ permission: "take pictures and videos", type: "Camera" }],
    }));

function makeRes() {
    return {
        headers: {},
        statusCode: 200,
        setHeader(k, v) {
            this.headers[k] = v;
        },
        getHeader(k) {
            return this.headers[k];
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
        },
        send(body) {
            this.body = body;
        },
        end() {},
    };
}

async function quietly(fn) {
    const origLog = console.log;
    console.log = () => {};
    try {
        return await fn();
    } finally {
        console.log = origLog;
    }
}

async function scrape(query) {
    const res = makeRes();
    await quietly(() => scrapeList({ query }, res));
    return res;
}

async function download(query) {
    const res = makeRes();
    // downloadTopChartsCSV runs the cors middleware, which hands back control asynchronously
    await quietly(
        () =>
            new Promise((resolve) => {
                const origSend = res.send;
                res.send = function (body) {
                    origSend.call(this, body);
                    resolve();
                };
                res.json = function (body) {
                    this.body = body;
                    resolve();
                };
                downloadTopChartsCSV({ query, headers: {}, method: "GET" }, res);
            }),
    );
    return res;
}

const csvRows = (res) => (typeof res.body === "string" ? res.body.split("\n") : []);
const combo = { collection: "TOP_FREE", category: "GAME_PUZZLE", country: "us" };
const downloadQuery = combo.collection + combo.category + combo.country; // what the frontend sends

test("downloading before anything was scraped returns 404, not 500", async () => {
    const res = await download({ query: "NOPE", includePermissions: "false" });
    assert.strictEqual(res.statusCode, 404);
});

test("a later scrape of the same chart by another client does not change the first client's download", async () => {
    const first = await scrape({ ...combo, num: "5", includePermissions: "false" });
    assert.strictEqual(first.body.totalCount, 5);

    const second = await scrape({ ...combo, num: "3", includePermissions: "false" });
    assert.strictEqual(second.body.totalCount, 3);

    const dl = await download({ query: downloadQuery, num: "5", includePermissions: "false" });
    assert.strictEqual(dl.statusCode, 200);
    assert.strictEqual(csvRows(dl).length - 1, 5, "first client should still get the 5 rows they scraped");
});

test("includePermissions=false does not fetch or return permissions", async () => {
    const res = await scrape({ ...combo, num: "2", includePermissions: "false" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.results[0].permissions, undefined);
});

test("a permissions-less data set requested with includePermissions=true gets a 4xx, not a 500", async () => {
    await scrape({ ...combo, num: "2", includePermissions: "false" });
    const dl = await download({ query: downloadQuery, num: "2", includePermissions: "true" });
    assert.ok(dl.statusCode >= 400 && dl.statusCode < 500, "expected 4xx, got " + dl.statusCode);
});

test("a data set scraped with permissions downloads with the permission columns", async () => {
    const res = await scrape({ ...combo, num: "2", includePermissions: "true" });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.results[0].permissions));

    const dl = await download({ query: downloadQuery, num: "2", includePermissions: "true" });
    assert.strictEqual(dl.statusCode, 200);
    const rows = csvRows(dl);
    assert.strictEqual(rows.length - 1, 2);
    assert.ok(rows[0].includes('"take pictures and videos"'), "header should include the standard permission columns");
    assert.ok(rows[1].includes("true"), "the camera permission should be marked true");
});

test("scrape without num and download without num use the same key (how the frontend calls it)", async () => {
    const res = await scrape({ ...combo, includePermissions: "false" });
    assert.strictEqual(res.statusCode, 200);
    const dl = await download({ query: downloadQuery, includePermissions: "false" });
    assert.strictEqual(dl.statusCode, 200);
    assert.strictEqual(csvRows(dl).length - 1, res.body.totalCount);
});
