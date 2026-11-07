// /download-top-csv on a fresh process and on a cache miss. Each test file runs in
// its own process, so nothing has been scraped when these start. No store traffic.
const test = require("node:test");
const assert = require("node:assert");
const gplay = require("google-play-scraper");

gplay.list = async () => [{ appId: "com.example.one", title: "One", summary: "s", recentChanges: "c" }];

const app = require("../index");
let server;
let base;

test.before(async () => {
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

test("download before any scrape is a 404 JSON error, not a 500 with a stack trace", async () => {
    const res = await fetch(`${base}/download-top-csv?query=TOP_FREEus&includePermissions=false`);
    const text = await res.text();
    assert.strictEqual(res.status, 404);
    assert.match(res.headers.get("content-type"), /application\/json/);
    assert.doesNotMatch(text, /ReferenceError|node_modules|at /);
});
