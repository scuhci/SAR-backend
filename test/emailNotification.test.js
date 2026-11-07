// Regression tests for POST /email ("notify me") and the mail /search sends.
// google-play-scraper and nodemailer are stubbed before the controller loads,
// so these tests make no store requests and send no mail.
const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const gps = require("google-play-scraper");
const nodemailer = require("nodemailer");

const fixtureApp = (appId) => ({
  appId,
  title: "Fixture App",
  summary: "fixture summary",
  score: 4,
});
gps.search = async ({ term }) => [fixtureApp(term)];
gps.app = async ({ appId }) => fixtureApp(appId);

const sent = [];
let failSends = false;
nodemailer.createTransport = () => ({
  sendMail(opts, cb) {
    sent.push(opts);
    if (!cb) return;
    if (failSends) {
      const err = new Error(`Recipient address rejected: <${opts.to}>`);
      err.code = "EENVELOPE";
      err.responseCode = 550;
      cb(err);
    } else cb(null, { accepted: [opts.to] });
  },
});

// The controller sleeps between store calls; there is no store here.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) =>
  realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...args);

// Lets tests age registrations and rate-limit windows without waiting.
const realNow = Date.now;
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;
const advanceClock = (ms) => {
  clockOffset += ms;
};
const HOUR = 60 * 60 * 1000;

process.env.GMAIL_USER = "stub@example.invalid";
process.env.GMAIL_PASS = "stub";

const router = require("../routes/searchRoutes");
const controller = require("../controllers/searchController");
const tables = controller._notifyInternals;

let server;
let baseUrl;

before(async () => {
  mock.method(console, "log", () => {});
  mock.method(console, "error", () => {});
  // Drop morgan's access-log lines; leave the test runner's output alone.
  const realWrite = process.stdout.write.bind(process.stdout);
  mock.method(process.stdout, "write", (chunk, ...rest) =>
    /^\S+ - \S+ \[[^\]]+\] "/.test(String(chunk)) ? true : realWrite(chunk, ...rest),
  );
  // Same wiring as index.js.
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", router);
  app.post("/email", controller.addEmailNotification);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  mock.restoreAll();
  Date.now = realNow;
  global.setTimeout = realSetTimeout;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  sent.length = 0;
  failSends = false;
});

// Every test uses its own client IP (via X-Forwarded-For from loopback, as
// nginx sends it) so per-IP limits do not leak between tests.
let ipCounter = 0;
const freshIp = () => {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};

// Old-style request: values in the query string, as the live frontend sends.
const register = (email, queryId, ip) =>
  fetch(
    `${baseUrl}/email?${new URLSearchParams({ email, queryId })}`,
    { method: "POST", headers: { "X-Forwarded-For": ip } },
  );

const queryIdFor = (query, country = "us", permissions = false) =>
  `c:${country}_t:${query}_p:${permissions}`;

const runSearch = (query, country = "us") =>
  fetch(
    `${baseUrl}/api/search?${new URLSearchParams({
      query,
      countryCode: country,
      includePermissions: "false",
    })}`,
  );

test("rejects malformed and multi-recipient addresses", async () => {
  const ip = freshIp();
  for (const bad of [
    "not-an-email",
    "a@b",
    "victim@example.com, other@example.com",
    "victim@example.com\r\nBcc: other@example.com",
    "<script>@example.com",
    '"quoted"@example.com',
    `${"a".repeat(65)}@example.com`,
    `a@${"b".repeat(250)}.com`,
  ]) {
    const res = await register(bad, queryIdFor("maps"), ip);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
});

test("accepts ordinary valid addresses", async () => {
  for (const good of [
    "first+tag@uni.edu",
    "o'brien@mail.example.co.uk",
    "First.Last@sub.example-uni.edu",
  ]) {
    const res = await register(good, queryIdFor("maps"), freshIp());
    assert.equal(res.status, 200, `expected 200 for ${good}`);
  }
});

test("rejects a query id that is not one the search endpoint builds", async () => {
  const ip = freshIp();
  for (const bad of ["anything", "c:us_t:_p:false", "c:usa_t:x_p:maybe"]) {
    const res = await register("user@uni.edu", bad, ip);
    assert.equal(res.status, 400, `expected 400 for ${bad}`);
  }
  const long = queryIdFor("x".repeat(400));
  assert.equal((await register("user@uni.edu", long, ip)).status, 400);
});

test("rate limits registrations per client IP", async () => {
  const ip = freshIp();
  for (let i = 0; i < 10; i++) {
    const res = await register(`user${i}@uni.edu`, queryIdFor(`rl${i}`), ip);
    assert.equal(res.status, 200);
  }
  const blocked = await register("user@uni.edu", queryIdFor("rl-x"), ip);
  assert.equal(blocked.status, 429);
  // Other clients are unaffected, and the window resets.
  assert.equal(
    (await register("user@uni.edu", queryIdFor("rl-y"), freshIp())).status,
    200,
  );
  advanceClock(HOUR + 1000);
  assert.equal(
    (await register("user@uni.edu", queryIdFor("rl-z"), ip)).status,
    200,
  );
});

test("caps recipients per search, ignoring case for duplicates", async () => {
  const q = queryIdFor("cap-test");
  for (const email of ["a@uni.edu", "b@uni.edu", "c@uni.edu", "A@UNI.EDU"]) {
    assert.equal((await register(email, q, freshIp())).status, 200);
  }
  assert.equal((await register("d@uni.edu", q, freshIp())).status, 429);
});

test("caps pending searches and frees slots once registrations expire", async () => {
  advanceClock(48 * HOUR); // expire everything earlier tests registered
  // The first request sweeps the expired entries, so 500 fill the table.
  for (let i = 0; i < 500; i++) {
    const res = await register("u@uni.edu", queryIdFor(`p${i}`), freshIp());
    assert.equal(res.status, 200);
  }
  assert.equal(
    (await register("u@uni.edu", queryIdFor("one-too-many"), freshIp())).status,
    429,
  );
  advanceClock(25 * HOUR);
  assert.equal(
    (await register("u@uni.edu", queryIdFor("one-too-many"), freshIp())).status,
    200,
  );
  assert.equal(tables.emailMappings.size, 1, "expired registrations dropped");
  assert.ok(tables.notifyHitsByIp.size <= 1, "stale per-IP counters dropped");
});

test("expired registrations are not mailed", async () => {
  assert.equal(
    (await register("late@uni.edu", queryIdFor("stale"), freshIp())).status,
    200,
  );
  advanceClock(25 * HOUR);
  assert.equal((await runSearch("stale")).status, 200);
  assert.equal(sent.length, 0);
});

test("escapes the search term in the mail body and attachment name", async () => {
  const query = `<a href="https://evil.example">x</a>'&/..\\`;
  assert.equal(
    (await register("user@uni.edu", queryIdFor(query), freshIp())).status,
    200,
  );
  assert.equal((await runSearch(query)).status, 200);
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.to, "user@uni.edu");
  assert.ok(!mail.html.includes("<a href=\"https://evil.example\">"));
  assert.ok(!mail.html.includes("'&/"));
  assert.ok(
    mail.html.includes(
      "&lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;&#39;&amp;/..\\",
    ),
  );
  const filename = mail.attachments[0].filename;
  assert.match(filename, /^[\p{L}\p{N}._-]+\.csv$/u);
  assert.ok(mail.html.includes(filename));
  // Registration is consumed once mailed.
  assert.equal((await runSearch(query)).status, 200);
  assert.equal(sent.length, 1);
});

// SEC-04: the address travels in the JSON body; the query-string form is kept
// working until the frontend stops sending it.
const registerJson = (body, ip, rawQuery = "") =>
  fetch(`${baseUrl}/email${rawQuery}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });

test("accepts the address in the JSON body", async () => {
  const queryId = queryIdFor("json-body");
  const res = await registerJson({ email: "body@uni.edu", queryId }, freshIp());
  assert.equal(res.status, 200);
  await runSearch("json-body");
  assert.deepEqual(sent.map((m) => m.to), ["body@uni.edu"]);
});

test("still accepts the query-string form", async () => {
  const res = await register("qs@uni.edu", queryIdFor("query-form"), freshIp());
  assert.equal(res.status, 200);
  await runSearch("query-form");
  assert.deepEqual(sent.map((m) => m.to), ["qs@uni.edu"]);
});

test("prefers the body when both are sent, as the current frontend does", async () => {
  // The live frontend builds ?email=${email} without encoding, so a + in the
  // address arrives as a space in the query string. The body is intact.
  const queryId = queryIdFor("both-forms");
  const res = await registerJson(
    { email: "first+tag@uni.edu", queryId },
    freshIp(),
    `?email=first+tag@uni.edu&queryId=${encodeURIComponent(queryId)}`,
  );
  assert.equal(res.status, 200);
  await runSearch("both-forms");
  assert.deepEqual(sent.map((m) => m.to), ["first+tag@uni.edu"]);
});

test("never writes the address to the server log", async () => {
  const address = "private.person+smar@uni.edu";
  console.log.mock.resetCalls();
  console.error.mock.resetCalls();
  failSends = true; // also cover the send-failure log line
  const queryId = queryIdFor("log-check");
  assert.equal(
    (await register(address, queryId, freshIp())).status,
    200,
  );
  assert.equal(
    (await registerJson({ email: address, queryId }, freshIp())).status,
    200,
  );
  await runSearch("log-check");
  assert.equal(sent.length, 1);
  const logged = [...console.log.mock.calls, ...console.error.mock.calls]
    .flatMap((c) => c.arguments)
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a) + String(a)))
    .join("\n");
  assert.ok(!logged.includes("private.person"), "address appeared in a log line");
});
