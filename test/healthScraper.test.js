// /health/scraper must serve the periodic monitor's cached result, not run live
// store checks or move the monitor's failure counter. Scraper calls are stubbed.
const test = require("node:test");
const assert = require("node:assert");
const gplay = require("google-play-scraper");

let scraperCalls = 0;
for (const name of ["search", "app", "reviews", "list", "permissions"]) {
    gplay[name] = async () => {
        scraperCalls++;
        throw new Error("stubbed store outage");
    };
}

const app = require("../index");
const { isFlaggedStatus } = require("../utilities/healthCheck");
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

test("polling /health/scraper runs no store checks and cannot trip the alert flag", async () => {
    for (let i = 0; i < 3; i++) {
        const res = await fetch(`${base}/health/scraper`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual((await res.json()).overall, "unknown");
    }
    assert.strictEqual(scraperCalls, 0);
    assert.deepStrictEqual(isFlaggedStatus(), { flagged: false, consecutiveFailures: 0, flaggedAt: null });
});
