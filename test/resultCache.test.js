// Regression tests for utilities/resultCache.js: the per-process cache of scraped
// result sets must expire entries in the background (not only when they are read)
// and must stay bounded. google-play-scraper is stubbed, so no store traffic.
// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const express = require("express");
const nodeTTL = require("node-ttl");
const gplay = require("google-play-scraper");

const { createResultCache, DEFAULT_MAX_ENTRIES } = require("../utilities/resultCache");

// node-ttl measures age with os.uptime(); drive it from the test so TTLs elapse instantly.
let fakeUptime = os.uptime();
os.uptime = () => fakeUptime;

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("expired entries are swept without anyone calling get()", async () => {
    const cache = createResultCache({ checkPeriode: 10 });
    cache.push("k", { big: "result set" }, null, 1);
    assert.equal(cache.size(), 1);

    fakeUptime += 2; // past the 1s ttl
    await tick(50);

    assert.equal(cache.size(), 0);
    assert.equal(cache.get("k"), null);
});

test("the number of entries is capped and the oldest go first", () => {
    const cache = createResultCache({ maxEntries: 2 });
    cache.push("first", [1], null, 604800);
    cache.push("second", [2], null, 604800);
    cache.push("third", [3], null, 604800);

    assert.equal(cache.size(), 2);
    assert.equal(cache.get("first"), null);
    assert.deepEqual(cache.get("second"), [2]);
    assert.deepEqual(cache.get("third"), [3]);
});

test("reading an entry moves it to the newest eviction position", () => {
    const cache = createResultCache({ maxEntries: 3 });
    cache.push("a", [1], null, 604800);
    cache.push("b", [2], null, 604800);
    cache.push("c", [3], null, 604800);

    assert.deepEqual(cache.get("a"), [1]);
    cache.push("d", [4], null, 604800);

    assert.deepEqual(cache.get("a"), [1]);
    assert.equal(cache.get("b"), null);
    assert.equal(cache.size(), 3);
});

test("reading a missing entry does not add a slot", () => {
    const cache = createResultCache({ maxEntries: 3 });
    cache.push("a", [1], null, 604800);
    cache.push("b", [2], null, 604800);

    assert.equal(cache.get("missing"), null);
    cache.push("c", [3], null, 604800);

    assert.equal(cache.size(), 3);
    assert.deepEqual(cache.get("a"), [1]);
    assert.deepEqual(cache.get("b"), [2]);
    assert.deepEqual(cache.get("c"), [3]);
});

test("re-pushing an existing key refreshes it instead of counting twice", () => {
    const cache = createResultCache({ maxEntries: 2 });
    cache.push("first", [1], null, 604800);
    cache.push("second", [2], null, 604800);
    cache.push("first", [11], null, 604800); // same key again: now the newest
    cache.push("third", [3], null, 604800);

    assert.equal(cache.size(), 2);
    assert.equal(cache.get("second"), null);
    assert.deepEqual(cache.get("first"), [11]);
    assert.deepEqual(cache.get("third"), [3]);
});

test("entries removed by the sweep free their slot in the cap", async () => {
    const cache = createResultCache({ checkPeriode: 10, maxEntries: 2 });
    cache.push("short", [0], null, 1);
    cache.push("long", [1], null, 604800);
    fakeUptime += 2;
    await tick(50);
    assert.equal(cache.size(), 1);

    cache.push("another", [2], null, 604800);
    assert.equal(cache.size(), 2);
    assert.deepEqual(cache.get("long"), [1]);
    assert.deepEqual(cache.get("another"), [2]);
});

test("the top charts cache sweeps in the background and is capped", async () => {
    // Capture the cache instance listController builds by hooking node-ttl's push.
    const instances = new Set();
    const origPush = nodeTTL.prototype.push;
    nodeTTL.prototype.push = function (...args) {
        instances.add(this);
        return origPush.apply(this, args);
    };
    const origList = gplay.list;
    const origApp = gplay.app;
    const chartApp = { title: "App", appId: "com.example.app", summary: "s", score: 4, developer: "d", url: "u" };
    gplay.list = async () => [chartApp];
    gplay.app = async () => ({ ...chartApp });
    const origLog = console.log;
    console.log = () => {}; // the handler is chatty

    const { scrapeList } = require("../controllers/listController");
    const app = express();
    app.use("/toplists", scrapeList);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const queries = DEFAULT_MAX_ENTRIES + 20;
        for (let i = 0; i < queries; i++) {
            const res = await fetch(`${base}/toplists?collection=TOP_FREE&category=GAME&num=${i + 1}&country=us`);
            assert.equal(res.status, 200);
        }
        assert.equal(instances.size, 1);
        const [cache] = instances;
        assert.equal(cache.size(), DEFAULT_MAX_ENTRIES, "cap holds under more distinct queries than the cap");

        // The controller keeps results for a week; a sweep period means they go
        // when that elapses even if nobody downloads them (timed proof above).
        assert.ok(cache.getOptions().checkPeriode > 0, "cache must sweep in the background");
    } finally {
        console.log = origLog;
        gplay.list = origList;
        gplay.app = origApp;
        nodeTTL.prototype.push = origPush;
        await new Promise((resolve) => server.close(resolve));
    }
});

test("a top-chart result set evicted by the cap downloads as 404", async () => {
    const origList = gplay.list;
    const origApp = gplay.app;
    const origLog = console.log;
    const chartApp = { title: "App", appId: "com.example.app", summary: "s", score: 4, developer: "d", url: "u" };
    gplay.list = async () => [chartApp];
    gplay.app = async () => ({ ...chartApp });
    console.log = () => {};

    const { scrapeList, downloadTopChartsCSV } = require("../controllers/listController");
    const makeRes = () => ({
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
    });
    const scrape = async (query) => {
        const res = makeRes();
        await scrapeList({ query }, res);
        return res;
    };
    const download = async (query) => {
        const res = makeRes();
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
        return res;
    };

    try {
        const victim = {
            collection: "TOP_FREE",
            category: "GAME_ARCADE",
            country: "us",
            num: "1",
            includePermissions: "false",
        };
        const victimScrape = await scrape(victim);
        assert.equal(victimScrape.statusCode, 200);

        for (let i = 1; i <= DEFAULT_MAX_ENTRIES; i++) {
            const res = await scrape({
                ...victim,
                category: "GAME_BOARD",
                num: String(i),
            });
            assert.equal(res.statusCode, 200);
        }

        const dl = await download({
            query: "TOP_FREEGAME_ARCADEus",
            num: "1",
            includePermissions: "false",
        });
        assert.equal(dl.statusCode, 404);
        assert.match(dl.body.error, /search again/i);
    } finally {
        console.log = origLog;
        gplay.list = origList;
        gplay.app = origApp;
    }
});
