// Regression tests for the chart rank column and for recording skipped apps in the
// reproducibility log. The scraper and the permissions lookup are stubbed, so no
// live store traffic. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const gplay = require("google-play-scraper");
const permissionsController = require("../controllers/permissionsController");
const {
    scrapeList,
    downloadTopChartsCSV,
    downloadTopChartsRelog,
} = require("../controllers/listController");

const appIds = Array.from({ length: 5 }, (_, i) => "com.r" + (i + 1));
let skippedIds = new Set();

gplay.list = async () => appIds.map((appId, i) => ({ appId, title: "T" + (i + 1) }));
gplay.app = async ({ appId }) => {
    if (skippedIds.has(appId)) {
        throw new Error("App not found (404)");
    }
    return { appId, title: "T" + appId.slice(-1), summary: "s", score: 4.5, url: "u" };
};
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
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        return await fn();
    } finally {
        console.log = origLog;
        console.error = origError;
    }
}

async function scrape(category, includePermissions = "false") {
    const res = makeRes();
    await quietly(() =>
        scrapeList(
            {
                query: {
                    collection: "TOP_FREE",
                    category,
                    country: "us",
                    includePermissions,
                },
            },
            res,
        ),
    );
    return res;
}

function corsHandler(handler, query) {
    const res = makeRes();
    // The download handlers use cors middleware, which calls the callback asynchronously.
    return quietly(
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
                handler({ query, headers: {}, method: "GET" }, res);
            }),
    ).then(() => res);
}

function chartQuery(category) {
    return "TOP_FREE" + category + "us";
}

function parseCsv(res) {
    assert.strictEqual(res.statusCode, 200);
    return res.body.split("\n").map((line) =>
        line.split(",").map((value) => value.replace(/^"|"$/g, "")),
    );
}

async function csv(category, includePermissions = "false") {
    return corsHandler(downloadTopChartsCSV, {
        query: chartQuery(category),
        includePermissions,
    });
}

async function relog(category, includePermissions = "false", totalCount = "5") {
    return corsHandler(downloadTopChartsRelog, {
        collection: "TOP_FREE",
        category,
        country: "us",
        includePermissions,
        totalCount,
    });
}

test("CSV includes original chart ranks when no app is skipped", async () => {
    skippedIds = new Set();
    const category = "GAME_PUZZLE";
    await scrape(category);

    const response = await csv(category);
    const rows = parseCsv(response);
    assert.ok(rows[0].includes("rank"), "CSV has a rank column");
    const rankColumn = rows[0].indexOf("rank");
    const appIdColumn = rows[0].indexOf("appId");
    const ranks = Object.fromEntries(rows.slice(1).map((row) => [row[appIdColumn], row[rankColumn]]));
    assert.deepStrictEqual(ranks, {
        "com.r1": "1",
        "com.r2": "2",
        "com.r3": "3",
        "com.r4": "4",
        "com.r5": "5",
    });

    const log = await relog(category, "false", "5");
    assert.match(log.body, /num_skipped: 0/);
    assert.match(log.body, /skipped_app_ids: none/);
});

test("skipped app retains its position in results, CSV, and relog", async () => {
    skippedIds = new Set(["com.r2"]);
    const category = "GAME_ARCADE";
    const response = await scrape(category);
    assert.strictEqual(response.body.totalCount, 4);
    assert.strictEqual(response.body.results[1].rank, 3);

    const rows = parseCsv(await csv(category));
    const rankColumn = rows[0].indexOf("rank");
    const appIdColumn = rows[0].indexOf("appId");
    const ranks = Object.fromEntries(rows.slice(1).map((row) => [row[appIdColumn], row[rankColumn]]));
    assert.deepStrictEqual(ranks, {
        "com.r1": "1",
        "com.r3": "3",
        "com.r4": "4",
        "com.r5": "5",
    });

    const log = await relog(category, "false", "4");
    assert.match(log.body, /num_results: 4/);
    assert.match(log.body, /num_skipped: 1/);
    assert.match(log.body, /skipped_app_ids: com\.r2 \(rank 2\)\n/);
});

test("relog finds skipped apps when permissions were enabled for the scrape", async () => {
    skippedIds = new Set(["com.r2"]);
    const category = "GAME_CARD";
    await scrape(category, "true");

    const rows = parseCsv(await csv(category, "true"));
    assert.ok(rows[0].includes("rank"), "CSV has a rank column");
    const rankColumn = rows[0].indexOf("rank");
    const appIdColumn = rows[0].indexOf("appId");
    const ranks = Object.fromEntries(rows.slice(1).map((row) => [row[appIdColumn], row[rankColumn]]));
    assert.deepStrictEqual(ranks, {
        "com.r1": "1",
        "com.r3": "3",
        "com.r4": "4",
        "com.r5": "5",
    });

    const log = await relog(category, "false", "4");
    assert.match(log.body, /num_skipped: 1/);
});

test("relog reports unknown skipped apps when the chart was never scraped", async () => {
    skippedIds = new Set();
    const log = await relog("GAME_SIMULATION", "false", "0");
    assert.strictEqual(log.statusCode, 200);
    assert.match(log.body, /num_skipped: unknown/);
    assert.doesNotMatch(log.body, /skipped_app_ids/);
});
