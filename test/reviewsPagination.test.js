// Regression tests for Play reviews paging against the real scraper library.
const test = require("node:test");
const assert = require("node:assert/strict");

// Runs the real google-play-scraper reviews code with only its HTTP layer replaced
// by a fake store, to check what the library itself does with tokens. No network.
const requestPath = require.resolve("google-play-scraper/lib/utils/request");
const requests = [];
let pages;
let calls = 0;

require.cache[requestPath] = {
    id: requestPath,
    filename: requestPath,
    loaded: true,
    exports: async (opts) => {
        calls++;
        if (calls > 50) throw new Error("request limit exceeded");
        const decodedBody = decodeURIComponent(opts.body);
        const tokenMatch = decodedBody.match(/\\"([^\\"]+)\\"\]/);
        requests.push({ count: calls, token: tokenMatch ? tokenMatch[1] : null });
        const page = typeof pages === "function" ? pages(calls) : pages[Math.min(calls - 1, pages.length - 1)];
        const reviews = Array.from({ length: page.count }, (_, i) => [
            `rid-${page.startIndex + i}`,
            ["user"],
            5,
            null,
            `text ${page.startIndex + i}`,
            [1704067200, 0],
            0,
        ]);
        const data = [reviews, [null, page.token]];
        return ")]}'\n" + JSON.stringify([[null, null, JSON.stringify(data)]]);
    },
};

const gplay = require("google-play-scraper");
const { scrapeReviews } = require("../controllers/reviewsController");

const storePage = (startIndex, count, token) => ({ startIndex, count, token });

function makeRes() {
    return {
        headers: {},
        statusCode: 200,
        set() { return this; },
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; },
        send(body) { this.body = body; },
    };
}

async function scrape(t, appId, storePages) {
    const original = { app: gplay.app, log: console.log };
    pages = storePages;
    calls = 0;
    requests.length = 0;
    gplay.app = async () => ({ reviews: 1000 });
    console.log = () => {};
    t.after(() => {
        gplay.app = original.app;
        console.log = original.log;
    });

    const res = makeRes();
    await scrapeReviews({ query: { appId, countryCode: "US" }, headers: {}, method: "GET" }, res);
    const ids = typeof res.body === "string" ? res.body.match(/rid-\d+/g) || [] : [];
    return { res, ids };
}

test("GSR-01: a short page with a token does not lose the following rows", async (t) => {
    const { res, ids } = await scrape(t, "com.example.short-page", [
        storePage(0, 100, "T1"),
        storePage(100, 150, "T2"),
        storePage(250, 20, null),
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map((request) => request.token), [null, "T1", "T2"]);
    assert.equal(new Set(ids).size, 270);
});

test("GSR-01: an empty store page with a token ends the scrape", async (t) => {
    const { res, ids } = await scrape(t, "com.example.empty-first", () => storePage(0, 0, "TOK"));
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests.map((request) => request.token), [null]);
    assert.equal(new Set(ids).size, 0);
});

test("GSR-01: an empty page after a full page ends the scrape", async (t) => {
    const { res, ids } = await scrape(t, "com.example.empty-after-full", (call) => call === 1
        ? storePage(0, 150, "T1")
        : storePage(150, 0, "TOK"));
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((request) => request.token), [null, "T1"]);
    assert.equal(new Set(ids).size, 150);
});
