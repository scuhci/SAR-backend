// Top charts controller tests. gplay.list is stubbed, so there is no store traffic.
const test = require("node:test");
const assert = require("node:assert");
const gplay = require("google-play-scraper");
const { scrapeList } = require("../controllers/listController");

const fakeApp = (i) => ({ appId: "com.example.app" + i, title: "App " + i, summary: "s", recentChanges: "c" });

// Replace gplay.list with canned results and record every options object sent.
function stubList(results) {
    const calls = [];
    gplay.list = async (options) => {
        calls.push(options);
        return results;
    };
    return calls;
}

function makeRes() {
    return {
        statusCode: 200,
        headers: {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        },
        json(body) {
            this.body = body;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
    };
}

// Express 4 does not catch a rejected async handler, so the handler itself must resolve.
async function scrape(query) {
    const res = makeRes();
    const log = console.log;
    console.log = () => {};
    try {
        await assert.doesNotReject(() => scrapeList({ query }, res));
    } finally {
        console.log = log;
    }
    return res;
}

test("GET /toplists without collection returns 400 instead of rejecting", async () => {
    const calls = stubList([fakeApp(1)]);
    const res = await scrape({ category: "GAME_PUZZLE", country: "us" });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /collection/i);
    assert.strictEqual(calls.length, 0);
});

test("repeated collection parameter returns 400", async () => {
    const calls = stubList([fakeApp(1)]);
    const res = await scrape({ collection: ["TOP_FREE", "TOP_PAID"], category: "", country: "us" });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(calls.length, 0);
});

test("a valid query (as the frontend sends it) still returns the list", async () => {
    const calls = stubList([fakeApp(1), fakeApp(2)]);
    const res = await scrape({ collection: "TOP_FREE", category: "", country: "US", includePermissions: "false" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.totalCount, 2);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].collection, "TOP_FREE");
});
