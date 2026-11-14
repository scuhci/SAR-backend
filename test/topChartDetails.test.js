// Regression tests for loading a top chart's app detail pages. gplay.list and
// gplay.app are stubbed, so there is no live store traffic. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const gplay = require("google-play-scraper");
const { scrapeList, downloadTopChartsCSV } = require("../controllers/listController");
const mappingHelpers = require("google-play-scraper/lib/utils/mappingHelpers");

const listEntry = (i) => ({ appId: "com.example.app" + i, title: "App " + i, summary: "summary " + i });
const detailFor = (appId) => ({ appId: appId, title: "Detailed " + appId, summary: "summary <b>html</b>" });

// gplay.list behaves like the library: with fullDetail it loads every detail page with
// Promise.all. gplay.app fails for the app IDs in `failing` with the error the library
// throws for a page without a category block.
function stubStore(entries, failing = []) {
    const appCalls = [];
    let inFlight = 0;
    let maxInFlight = 0;
    gplay.app = (options) => {
        appCalls.push(options);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const delay = (appCalls.length * 7) % 5; // finish out of order
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                inFlight--;
                if (failing.includes(options.appId)) {
                    reject(new TypeError("Cannot read properties of undefined (reading 'length')"));
                } else {
                    resolve(detailFor(options.appId));
                }
            }, delay);
        });
    };
    gplay.list = async (options) =>
        options.fullDetail ? Promise.all(entries.map((e) => gplay.app({ appId: e.appId }))) : entries;
    return { appCalls, maxInFlight: () => maxInFlight };
}

async function run(query) {
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
        },
    };
    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        await scrapeList({ query }, res);
    } finally {
        console.log = origLog;
        console.error = origError;
    }
    return res;
}

async function download(query) {
    const res = {
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
    const origLog = console.log;
    console.log = () => {};
    try {
        await new Promise((resolve) => {
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
        });
    } finally {
        console.log = origLog;
    }
    return res;
}

const QUERY = { collection: "TOP_FREE", category: "HEALTH_AND_FITNESS", country: "us", includePermissions: "false" };

test("a store page without a category block no longer makes the scraper throw", () => {
    assert.deepStrictEqual(mappingHelpers.extractCategories(undefined), []);
    assert.deepStrictEqual(mappingHelpers.extractCategories(null), []);
    assert.deepStrictEqual(mappingHelpers.extractCategories([["Health & Fitness", null, "HEALTH_AND_FITNESS", 1]]), [
        { name: "Health & Fitness", id: "HEALTH_AND_FITNESS" },
    ]);
    // nested entries that are not arrays are skipped too, as in upstream 10.x
    const nested = [[["Health & Fitness", null, "HEALTH_AND_FITNESS", 1]], undefined, [null, 7]];
    assert.deepStrictEqual(mappingHelpers.extractCategories(nested), [
        { name: "Health & Fitness", id: "HEALTH_AND_FITNESS" },
    ]);
});

test("one failing app detail no longer fails the whole chart", async () => {
    stubStore([listEntry(1), listEntry(2), listEntry(3)], ["com.example.app2"]);
    const res = await run(QUERY);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.totalCount, 2);
    assert.deepStrictEqual(
        res.body.results.map((app) => app.appId),
        ["com.example.app1", "com.example.app3"],
    );
    assert.deepStrictEqual(res.body.skipped.map((app) => [app.rank, app.appId]), [[2, "com.example.app2"]]);
    assert.match(res.body.skipped[0].error, /reading 'length'/);
});

test("up to 10% of detail pages failing still returns the chart", async () => {
    const entries = Array.from({ length: 200 }, (_, i) => listEntry(i + 1));
    const failing = entries.slice(0, 20).map((entry) => entry.appId);
    stubStore(entries, failing);
    const res = await run({ ...QUERY, category: "GAME_ACTION" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.totalCount, 180);
    assert.strictEqual(res.body.skipped.length, 20);
});

test("more than 10% of detail pages failing is a 502 and nothing is stored", async () => {
    const entries = Array.from({ length: 200 }, (_, i) => listEntry(i + 1));
    const failing = entries.slice(0, 21).map((entry) => entry.appId);
    stubStore(entries, failing);
    const query = { ...QUERY, category: "GAME_ARCADE" };
    const res = await run(query);
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.body.skipped.length, 21);
    assert.match(res.body.error, /21 of 200/);

    const dl = await download({
        query: query.collection + query.category + query.country,
        includePermissions: "false",
    });
    assert.strictEqual(dl.statusCode, 404);
});

test("almost every detail page failing is a 502, not a one-row chart", async () => {
    const entries = Array.from({ length: 200 }, (_, i) => listEntry(i + 1));
    const failing = entries.slice(1).map((entry) => entry.appId);
    stubStore(entries, failing);
    const res = await run({ ...QUERY, category: "GAME_CASUAL" });
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.body.skipped.length, 199);
});

test("all details load: full details in chart order, nothing skipped, at most 10 requests at once", async () => {
    const entries = Array.from({ length: 25 }, (_, i) => listEntry(i + 1));
    const { appCalls, maxInFlight } = stubStore(entries);
    const res = await run({ ...QUERY, country: "gb" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.totalCount, 25);
    assert.deepStrictEqual(
        res.body.results.map((app) => app.title),
        entries.map((e) => "Detailed " + e.appId),
    );
    assert.deepStrictEqual(res.body.skipped, []);
    assert.strictEqual(appCalls.length, 25);
    assert.ok(appCalls.every((call) => call.country === "gb"));
    assert.ok(maxInFlight() <= 10, `expected at most 10 in flight, saw ${maxInFlight()}`);
    assert.strictEqual(res.body.results[0].summary, "summary html");
});

test("num limits the detail requests to the apps that are returned", async () => {
    const { appCalls } = stubStore(Array.from({ length: 30 }, (_, i) => listEntry(i + 1)));
    const res = await run({ ...QUERY, num: "5" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.totalCount, 5);
    assert.strictEqual(appCalls.length, 5);
});

test("every detail page failing is a 502, not an empty chart", async () => {
    stubStore([listEntry(1), listEntry(2)], ["com.example.app1", "com.example.app2"]);
    const res = await run(QUERY);
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.body.skipped.length, 2);
});

test("gplay.list itself failing is still a 500", async () => {
    gplay.list = async () => {
        throw new Error("store down");
    };
    const res = await run(QUERY);
    assert.strictEqual(res.statusCode, 500);
});
