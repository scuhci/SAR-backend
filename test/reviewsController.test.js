// Regression tests for the Play reviews scrape. google-play-scraper is stubbed
// in-process, so nothing here talks to the live store. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const gplay = require("google-play-scraper");
const { scrapeReviews, downloadReviewsRelog } = require("../controllers/reviewsController");

// More store calls than this means the pagination loop is not terminating.
const MAX_CALLS = 100;

const review = (i) => ({ id: "rid-" + i, userName: "user", score: 5, text: "text " + i, date: "2026-01-01T00:00:00.000Z" });
const page = (start, count, nextPaginationToken) => ({
    data: Array.from({ length: count }, (_, i) => review(start + i)),
    nextPaginationToken,
});

// Stub the store. `pages` is either a list returned in call order (the last one
// repeats) or a function of the request options. Returns the recorded requests.
function stubStore(t, { reported, pages }) {
    const requests = [];
    const orig = { app: gplay.app, reviews: gplay.reviews, log: console.log };
    gplay.app = async () => ({ reviews: reported });
    gplay.reviews = async (options) => {
        requests.push({ ...options });
        if (requests.length > MAX_CALLS) throw new Error("pagination loop did not terminate");
        if (typeof pages === "function") return pages(options);
        return pages[Math.min(requests.length - 1, pages.length - 1)];
    };
    console.log = () => {}; // the controller logs every page
    t.after(() => {
        gplay.app = orig.app;
        gplay.reviews = orig.reviews;
        console.log = orig.log;
    });
    return requests;
}

function makeRes() {
    return {
        headers: {},
        statusCode: 200,
        set() { return this; },
        setHeader(k, v) { this.headers[k] = v; },
        getHeader(k) { return this.headers[k]; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; },
        send(body) { this.body = body; },
        end() {},
    };
}

async function scrape(query = {}) {
    const res = makeRes();
    await scrapeReviews({ query: { appId: "com.example.app", countryCode: "US", ...query }, headers: {}, method: "GET" }, res);
    const ids = typeof res.body === "string" ? res.body.match(/rid-\d+/g) || [] : [];
    return { res, ids };
}

// Fetch the reviews relog and return its "key: value" lines as an object
function relog(query = {}) {
    const res = makeRes();
    const q = { appId: "com.example.app", countryCode: "US", store: "Google Play Store", sorting: "RECENT", ...query };
    downloadReviewsRelog({ query: q, headers: {}, method: "GET" }, res);
    const fields = {};
    for (const line of String(res.body).split("\n")) {
        const i = line.indexOf(": ");
        if (i > 0) fields[line.slice(0, i)] = line.slice(i + 2);
    }
    return fields;
}

const tokens = (requests) => requests.map((r) => r.nextPaginationToken);

test("GSR-01: stops when the store returns an empty first page", async (t) => {
    const requests = stubStore(t, { reported: 300, pages: [page(0, 0, null)] });
    const { res, ids } = await scrape();
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(ids.length, 0);
});

test("GSR-01: stops on a null token instead of restarting from page one", async (t) => {
    const requests = stubStore(t, { reported: 300, pages: [page(0, 150, "TOKEN_A"), page(150, 100, null)] });
    const { res, ids } = await scrape();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(tokens(requests), [undefined, "TOKEN_A"]);
    assert.equal(ids.length, 250);
    assert.equal(new Set(ids).size, 250, "no duplicate reviews");
});

test("GSR-01: stops when the store hands back the token it was just sent", async (t) => {
    const requests = stubStore(t, { reported: 1000, pages: [page(0, 150, "TOKEN_A"), page(150, 150, "TOKEN_A")] });
    const { res, ids } = await scrape();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(tokens(requests), [undefined, "TOKEN_A"]);
    assert.equal(ids.length, 300);
    assert.equal(new Set(ids).size, 300, "no duplicate reviews");
});

test("GSR-01: stops when an empty page still carries a token", async (t) => {
    const requests = stubStore(t, { reported: 1000, pages: [page(0, 150, "TOKEN_A"), page(0, 0, "TOKEN_B")] });
    const { res, ids } = await scrape();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(tokens(requests), [undefined, "TOKEN_A"]);
    assert.equal(ids.length, 150);
});

test("GSR-01: stops when tokens cycle and pages repeat reviews already collected", async (t) => {
    const requests = stubStore(t, {
        reported: 1000,
        pages: (o) => (o.nextPaginationToken === "TOKEN_A" ? page(0, 150, "TOKEN_B") : page(0, 150, "TOKEN_A")),
    });
    const { res, ids } = await scrape();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(tokens(requests), [undefined, "TOKEN_A"]);
    assert.equal(ids.length, 150);
    assert.equal(new Set(ids).size, 150, "no duplicate reviews");
});

test("GSR-01: still pages to the end when the store cooperates", async (t) => {
    const requests = stubStore(t, {
        reported: 450,
        pages: [page(0, 150, "TOKEN_A"), page(150, 150, "TOKEN_B"), page(300, 150, null)],
    });
    const { res, ids } = await scrape();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(tokens(requests), [undefined, "TOKEN_A", "TOKEN_B"]);
    assert.equal(ids.length, 450);
    assert.equal(new Set(ids).size, 450);
});

test("GSR-06: scrapes every review when the app page under-reports the count", async (t) => {
    const appId = "com.example.underreported";
    const requests = stubStore(t, { reported: 1, pages: [page(0, 22, null)] });
    const { res, ids } = await scrape({ appId });
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(ids.length, 22);
    const log = relog({ appId });
    assert.equal(log.num_reviews, "22");
    assert.equal(log.store_reported_reviews, "1");
});

test("GSR-06: relog reports 0 rows when the store has none, not the app page count", async (t) => {
    const appId = "com.example.overreported";
    stubStore(t, { reported: 300, pages: [page(0, 0, null)] });
    const { res, ids } = await scrape({ appId });
    assert.equal(res.statusCode, 200);
    assert.equal(ids.length, 0);
    const log = relog({ appId });
    assert.equal(log.num_reviews, "0");
    assert.equal(log.store_reported_reviews, "300");
});

test("GSR-06: stops at 10,000 rows and the relog reports rows written", async (t) => {
    const appId = "com.example.huge";
    const requests = stubStore(t, {
        reported: 1943447,
        pages: (o) => {
            const from = Number(o.nextPaginationToken || 0);
            return page(from, 150, String(from + 150));
        },
    });
    const { res, ids } = await scrape({ appId });
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, Math.ceil(10000 / 150));
    assert.equal(ids.length, 10000);
    assert.equal(new Set(ids).size, 10000);
    const log = relog({ appId });
    assert.equal(log.num_reviews, "10000");
    assert.equal(log.store_reported_reviews, "1943447");
});

test("GSR-07: reviews are requested in the store country's language", async (t) => {
    const cases = { JP: "ja", jp: "ja", DE: "de", BR: "pt", TW: "zh-TW", CN: "zh-CN", MX: "es", US: "en", GB: "en", IN: "en", AQ: "en", ZZ: "en" };
    const requests = stubStore(t, { reported: 2, pages: [page(0, 2, null)] });
    for (const [countryCode, lang] of Object.entries(cases)) {
        requests.length = 0;
        const { res } = await scrape({ countryCode });
        assert.equal(res.statusCode, 200);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].country, countryCode);
        assert.equal(requests[0].lang, lang, countryCode);
    }
});

test("GSR-07: a missing or repeated countryCode falls back to English", async (t) => {
    const requests = stubStore(t, { reported: 2, pages: [page(0, 2, null)] });
    for (const countryCode of [undefined, "", ["JP", "US"]]) {
        requests.length = 0;
        const { res } = await scrape({ countryCode });
        assert.equal(res.statusCode, 200);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].lang, "en");
    }
});

test("a store error mid-scrape answers 500 and records nothing for the relog", async (t) => {
    const appId = "com.example.failing";
    const requests = stubStore(t, {
        reported: 1000,
        pages: (o) => {
            if (o.nextPaginationToken === "TOKEN_B") throw new Error("store unavailable");
            return o.nextPaginationToken ? page(150, 150, "TOKEN_B") : page(0, 150, "TOKEN_A");
        },
    });
    const origError = console.error;
    console.error = () => {};
    t.after(() => { console.error = origError; });
    const { res } = await scrape({ appId });
    assert.equal(res.statusCode, 500);
    assert.equal(requests.length, 3);
    assert.equal(relog({ appId }).num_reviews, "");
});

test("GSR-07: the relog records the language the reviews were fetched in", async (t) => {
    stubStore(t, { reported: 2, pages: [page(0, 2, null)] });
    await scrape({ appId: "com.example.jp", countryCode: "JP" });
    const log = relog({ appId: "com.example.jp", countryCode: "JP" });
    assert.equal(log.lang, "ja");
    // Play ignores the country for reviews; the log has to say so next to the language
    assert.match(log.note, /by language only/);
});

test("GSR-07: a valid lang parameter overrides the country language", async (t) => {
    const cases = [
        ["IN", "hi"],
        ["CA", "fr"],
        ["JP", "en"],
        ["BR", "pt-BR"],
        ["TW", "zh-CN"],
    ];
    const requests = stubStore(t, { reported: 2, pages: [page(0, 2, null)] });
    for (const [countryCode, lang] of cases) {
        requests.length = 0;
        const { res } = await scrape({ countryCode, lang });
        assert.equal(res.statusCode, 200);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].country, countryCode);
        assert.equal(requests[0].lang, lang);
    }
});

test("GSR-07: an invalid lang parameter falls back to the country language", async (t) => {
    const invalidLanguages = ["", "EN", "english", "ja_JP", "ja;rm", "../x", ["hi", "fr"]];
    const requests = stubStore(t, { reported: 2, pages: [page(0, 2, null)] });
    for (const lang of invalidLanguages) {
        requests.length = 0;
        const { res } = await scrape({ countryCode: "JP", lang });
        assert.equal(res.statusCode, 200);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].lang, "ja");
    }
});

test("GSR-07: the relog records an overridden language", async (t) => {
    stubStore(t, { reported: 2, pages: [page(0, 2, null)] });
    await scrape({ appId: "com.example.hindi", countryCode: "IN", lang: "hi" });
    const log = relog({ appId: "com.example.hindi", countryCode: "IN" });
    assert.equal(log.lang, "hi");
});

test("N-GPLAY-01: reviewer names and avatars are in neither the CSV nor the server log", async (t) => {
    const inspect = require("node:util").inspect;
    const originals = {
        app: gplay.app,
        reviews: gplay.reviews,
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
    };
    const logLines = [];
    const capture = (...args) => logLines.push(args.map((arg) => typeof arg === "string" ? arg : inspect(arg)).join(" "));
    const rows = Array.from({ length: 12 }, (_, i) => ({
        id: "rev-" + i,
        userName: "Pat Example-" + i,
        userImage: "https://img.invalid/avatar-" + i,
        score: 4,
        text: "review body " + i,
        url: "https://play.invalid/r/" + i,
        date: "2026-01-01T00:00:00.000Z",
    }));

    gplay.app = async () => ({ reviews: 12 });
    gplay.reviews = async () => ({ data: rows, nextPaginationToken: undefined });
    console.log = capture;
    console.info = capture;
    console.warn = capture;
    console.error = capture;
    t.after(() => {
        gplay.app = originals.app;
        gplay.reviews = originals.reviews;
        console.log = originals.log;
        console.info = originals.info;
        console.warn = originals.warn;
        console.error = originals.error;
    });

    const res = makeRes();
    await scrapeReviews({ query: { appId: "com.example.private", countryCode: "US" }, headers: {}, method: "GET" }, res);

    assert.equal(res.statusCode, 200);
    const csv = String(res.body);
    assert.equal((csv.match(/rev-\d+/g) || []).length, 12);
    assert.doesNotMatch(csv, /Pat Example-\d+|img\.invalid\/avatar/);
    assert.equal(logLines.filter((line) => /Pat Example-\d+|img\.invalid\/avatar/.test(line)).length, 0);
});
