// Route-level tests against the exported Express app (no port 5001, no store traffic).
const test = require("node:test");
const assert = require("node:assert");
const gplay = require("google-play-scraper");

const listCalls = [];
gplay.list = async (options) => {
    listCalls.push(options);
    return [];
};

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

test("top charts routes only answer GET on their exact path", async () => {
    listCalls.length = 0;
    await fetch(`${base}/toplists?collection=TOP_FREE&category=&country=us`, { method: "POST" });
    await fetch(`${base}/toplists/sub/path?collection=TOP_FREE&category=&country=us`);
    assert.strictEqual(listCalls.length, 0, "the scrape must not run for POST or a sub-path");

    const res = await fetch(`${base}/toplists?collection=TOP_FREE&category=&country=us`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(listCalls.length, 1);
});

test("GET /toplists with a bogus category is a 400 JSON error", async () => {
    const res = await fetch(`${base}/toplists?collection=TOP_FREE&category=BOGUS&country=us`);
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /category/i);
});

test("errors raised before a handler (malformed JSON body) come back as JSON, not an HTML stack trace", async () => {
    const res = await fetch(`${base}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.headers.get("content-type"), /application\/json/);
    assert.doesNotMatch(await res.text(), /node_modules|SyntaxError: /);
});

test("unknown paths return 404 JSON instead of the frontend template", async () => {
    for (const [method, path] of [
        ["GET", "/doesnotexist"],
        ["GET", "/"],
        ["GET", "/toplists/sub/path"],
        ["POST", "/doesnotexist"],
    ]) {
        const res = await fetch(`${base}${path}`, { method });
        const text = await res.text();
        assert.strictEqual(res.status, 404, `${method} ${path}`);
        assert.match(res.headers.get("content-type"), /application\/json/, `${method} ${path}`);
        assert.doesNotMatch(text, /sar-frontend|index\.html|ENOENT|%PUBLIC_URL%/);
    }
});

test("/health still answers 200", async () => {
    const res = await fetch(`${base}/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, "ok");
});
