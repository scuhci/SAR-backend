// Replaces the google-play-scraper calls with canned data so the controllers
// can be exercised without any store traffic. Require this BEFORE the
// controllers: searchController destructures the scraper functions at load.
const gplay = require("google-play-scraper");

// What app() returns, in google-play-scraper's key order (appId and url come
// last). summary and recentChanges are HTML.
const STORE_APP = {
    title: "Quote App",
    description: "Full description",
    descriptionHTML: "Full <b>description</b>",
    summary: "Say &quot;hi&quot; to <b>everyone</b>",
    installs: "1,000+",
    minInstalls: 1000,
    maxInstalls: 1234,
    score: 4.5,
    scoreText: "4.5",
    ratings: 10,
    reviews: 2,
    histogram: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 9 },
    price: 0,
    originalPrice: null,
    discountEndDate: null,
    free: true,
    currency: "USD",
    priceText: "Free",
    available: true,
    offersIAP: false,
    IAPRange: undefined,
    androidVersion: "8.0",
    androidVersionText: "8.0 and up",
    androidMaxVersion: "VARY",
    developer: "Dev, Inc.",
    developerId: "Dev+Inc",
    developerEmail: "dev@example.com",
    developerWebsite: "https://example.com",
    developerAddress: "1 Main St\nSpringfield",
    privacyPolicy: "https://example.com/privacy",
    developerInternalID: "123",
    genre: "Tools",
    genreId: "TOOLS",
    categories: [{ name: "Tools", id: "TOOLS" }],
    icon: "https://example.com/icon.png",
    headerImage: "https://example.com/header.png",
    screenshots: ["https://example.com/s1.png"],
    contentRating: "Everyone",
    adSupported: false,
    released: "Jan 1, 2020",
    updated: 1700000000000,
    version: "1.0",
    recentChanges: "Fixed the &quot;crash&quot;<br>on launch",
    comments: [],
    preregister: false,
    earlyAccessEnabled: false,
    isAvailableInPlayPass: false,
    appId: "com.quote.app",
    url: "https://play.google.com/store/apps/details?id=com.quote.app",
};

// What the website and the CSV should show for those two fields.
const SUMMARY = 'Say "hi" to everyone';
const RECENT_CHANGES = 'Fixed the "crash" on launch';

const STORE_REVIEWS = [
    {
        id: "r1",
        userName: "A",
        userImage: "https://example.com/a.png",
        date: "2026-01-02T03:04:05.000Z",
        score: 2,
        scoreText: "2",
        url: "https://play.google.com/store/apps/details?id=com.quote.app&reviewId=r1",
        title: null,
        text: 'battery < 20% and > 10%, "drains" fast\nhelp',
        replyDate: null,
        replyText: null,
        version: null,
        thumbsUp: 3,
        criterias: [],
    },
];

gplay.search = async () => [
    {
        title: STORE_APP.title,
        appId: STORE_APP.appId,
        url: STORE_APP.url,
        icon: STORE_APP.icon,
        developer: STORE_APP.developer,
        developerId: STORE_APP.developerId,
        currency: STORE_APP.currency,
        price: STORE_APP.price,
        free: STORE_APP.free,
        summary: STORE_APP.summary,
        scoreText: "4.5",
        score: STORE_APP.score,
    },
];
gplay.app = async (options) => {
    if (options.appId !== STORE_APP.appId) {
        // the search controller probes the query as an app ID first
        const error = new Error("App not found (404)");
        error.status = 404;
        throw error;
    }
    return { ...STORE_APP };
};
gplay.list = async () => [{ ...STORE_APP }];
gplay.permissions = async () => [{ permission: "read your contacts", type: "Contacts" }];
gplay.reviews = async () => ({ data: STORE_REVIEWS.map((review) => ({ ...review })), nextPaginationToken: null });

// The controllers sleep between store calls; skip the wait.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms >= 1000 ? 1 : ms, ...args);

// Keep the controllers' console noise out of the test output.
console.log = () => {};
console.error = () => {};

const mockResponse = () => ({
    headers: {},
    statusCode: 200,
    set(name, value) {
        if (typeof name === "string") this.headers[name.toLowerCase()] = value;
        return this;
    },
    setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
        return this.headers[name.toLowerCase()];
    },
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
    send(body) {
        this.body = body;
        return this;
    },
});

const request = (query) => ({ headers: {}, method: "GET", query });

// Strict RFC 4180 parser: every field quoted or bare, "" inside quotes, CRLF or
// LF record ends. Throws on anything malformed (bare quote, text after a
// closing quote, unterminated quote).
function parseCsv(text) {
    const records = [];
    let record = [];
    let field = "";
    let i = 0;
    let quoted = false;
    let afterQuote = false;
    while (i < text.length) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                quoted = false;
                afterQuote = true;
            } else {
                field += ch;
            }
            i++;
            continue;
        }
        if (ch === ",") {
            record.push(field);
            field = "";
            afterQuote = false;
        } else if (ch === "\r" || ch === "\n") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            record.push(field);
            records.push(record);
            record = [];
            field = "";
            afterQuote = false;
        } else if (ch === '"') {
            if (field !== "" || afterQuote) throw new Error(`stray quote at offset ${i}`);
            quoted = true;
        } else {
            if (afterQuote) throw new Error(`text after closing quote at offset ${i}`);
            field += ch;
        }
        i++;
    }
    if (quoted) throw new Error("unterminated quoted field");
    if (field !== "" || record.length > 0 || afterQuote) {
        record.push(field);
        records.push(record);
    }
    return records;
}

// Parses a CSV into { header, rows: [{column: value}] } and checks every
// record has as many fields as the header.
function csvTable(text) {
    const [header, ...records] = parseCsv(text);
    for (const record of records) {
        if (record.length !== header.length) {
            throw new Error(`record has ${record.length} fields, header has ${header.length}`);
        }
    }
    return { header, rows: records.map((record) => Object.fromEntries(header.map((name, i) => [name, record[i]]))) };
}

module.exports = { STORE_APP, STORE_REVIEWS, SUMMARY, RECENT_CHANGES, mockResponse, request, parseCsv, csvTable };
