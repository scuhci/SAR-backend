// Keyword/app-ID search and its CSV download, through the exported app with
// google-play-scraper stubbed (no store traffic).
const test = require("node:test");
const assert = require("node:assert");

// The controller destructures { search, app } at require time, so stub first.
const gplay = require("google-play-scraper");

const calls = { search: [], app: [] };
let searchResults = [];
let probeError = null; // what app() throws for a query that is not a com.* app ID
let failDetails = false; // every detail fetch fails (simulated store throttling)

const notFound = () => Object.assign(new Error("App not found (404)"), { status: 404 });

gplay.search = async (opts) => {
    calls.search.push(opts);
    if (typeof opts.term !== "string") throw new TypeError("term must be a string");
    if (opts.term.startsWith("related to ")) return [];
    return searchResults;
};
gplay.app = async (opts) => {
    calls.app.push(opts);
    if (!opts.appId.startsWith("com.")) throw probeError || notFound();
    if (failDetails) throw Object.assign(new Error("Response code 429"), { status: 429 });
    return { appId: opts.appId, title: "Details " + opts.appId, summary: "s", genre: "Tools" };
};

// The controller sleeps 2-3 s between store requests; there is no store here.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...args);

const app = require("../index");
let server;
let base;

test.before(async () => {
    test.mock.method(console, "log", () => {});
    test.mock.method(console, "error", () => {});
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    test.mock.restoreAll();
    await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
    calls.search.length = 0;
    calls.app.length = 0;
    searchResults = [{ appId: "com.example.one", title: "Example One" }];
    probeError = null;
    failDetails = false;
});

test("download-csv for a search that is not cached is a 404 even after another search ran", async () => {
    const search = await fetch(`${base}/search?query=com.example.one&includePermissions=false&countryCode=US`);
    assert.strictEqual(search.status, 200);

    const miss = await fetch(`${base}/download-csv?query=never%20searched&includePermissions=false&countryCode=US`);
    assert.strictEqual(miss.status, 404);
    assert.match((await miss.json()).error, /search again/i);

    const hit = await fetch(`${base}/download-csv?query=com.example.one&includePermissions=false&countryCode=US`);
    assert.strictEqual(hit.status, 200);
    assert.match(await hit.text(), /com\.example\.one/);
});

test("repeated, blank or missing query and a malformed country are 400s with no store traffic", async () => {
    for (const qs of [
        "query=a&query=b&countryCode=US",
        "query=%20%20&countryCode=US",
        "countryCode=US",
        "query=fitness&countryCode=USA",
        "query=fitness&countryCode=US&countryCode=GB",
    ]) {
        const res = await fetch(`${base}/search?${qs}`);
        assert.strictEqual(res.status, 400, qs);
    }
    assert.strictEqual(calls.search.length + calls.app.length, 0);
});

test("a throttled app-ID probe fails the request instead of starting the keyword fan-out", async () => {
    probeError = Object.assign(new Error("Response code 429 (Too Many Requests)"), { status: 429 });
    searchResults = [
        { appId: "com.example.one", title: "Example One" },
        { appId: "com.example.two", title: "Example Two" },
    ];
    const res = await fetch(`${base}/search?query=fitness&countryCode=US`);
    assert.strictEqual(res.status, 500);
    const related = calls.search.filter((c) => c.term.startsWith("related to "));
    assert.strictEqual(related.length, 0, "no related-app searches after a 429");
});

test("a keyword (probe 404) still runs the related-app searches", async () => {
    const res = await fetch(`${base}/search?query=fitness&countryCode=US`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls.search.filter((c) => c.term.startsWith("related to ")).length, 1);
    assert.strictEqual((await res.json()).totalCount, 1);
});

test("a search the store has no apps for is 200 with zero results, not a 500", async () => {
    searchResults = [];
    const res = await fetch(`${base}/search?query=zzzz-no-such-app&countryCode=US`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { totalCount: 0, results: [] });
});
