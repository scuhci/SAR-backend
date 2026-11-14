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
let storeMode = "ok";
gps.search = async ({ term }) => {
  if (storeMode === "throttled") {
    const error = new Error("Too many requests");
    error.status = 429;
    throw error;
  }
  if (storeMode === "empty") return [];
  return [fixtureApp(term)];
};
gps.app = async ({ appId }) => {
  if (storeMode === "empty") throw new Error("Not an app id");
  return fixtureApp(appId);
};

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
  mock.method(console, "warn", () => {});
  // Drop morgan's access-log lines; leave the test runner's output alone.
  const realWrite = process.stdout.write.bind(process.stdout);
  mock.method(process.stdout, "write", (chunk, ...rest) =>
    /^\S+ - \S+ \[[^\]]+\] "/.test(String(chunk)) ? true : realWrite(chunk, ...rest),
  );
  // Same wiring as index.js.
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
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
  storeMode = "ok";
});

// Every test uses its own client IP (via X-Forwarded-For from loopback, as
// nginx sends it) so per-IP limits do not leak between tests.
let ipCounter = 0;
const freshIp = () => {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};

// SEC-04: the address is accepted only from a JSON body; query-string-only
// and form posts are rejected, while the query id may still come from the URL.
const registerJson = (body, ip, rawQuery = "") =>
  fetch(`${baseUrl}/email${rawQuery}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });

// Registration helper matching the deployed frontend's JSON body.
const register = (email, queryId, ip) => registerJson({ email, queryId }, ip);

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

test("a client-supplied X-Forwarded-For cannot dodge the per-IP limit", async () => {
  // nginx appends the real address; anything to its left came from the client.
  const real = freshIp();
  const attempt = (i) =>
    fetch(`${baseUrl}/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `10.9.8.${i}, ${real}`,
      },
      body: JSON.stringify({
        email: "user@uni.edu",
        queryId: queryIdFor(`spoof${i}`),
      }),
    });
  for (let i = 0; i < 10; i++) assert.equal((await attempt(i)).status, 200);
  assert.equal((await attempt(10)).status, 429);
});

test("warns once when the proxy does not pass the client address", async () => {
  console.warn.mock.resetCalls();
  for (const term of ["no-xff-1", "no-xff-2"]) {
    const res = await fetch(`${baseUrl}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@uni.edu", queryId: queryIdFor(term) }),
    });
    assert.equal(res.status, 200);
  }
  assert.equal(console.warn.mock.callCount(), 1);
  assert.match(String(console.warn.mock.calls[0].arguments[0]), /X-Forwarded-For/);
});

test("rejects non-string values", async () => {
  const ip = freshIp();
  const queryId = queryIdFor("types");
  for (const body of [
    { email: ["a@uni.edu", "b@uni.edu"], queryId },
    { email: { toString: "a@uni.edu" }, queryId },
    { email: 42, queryId },
    { email: "a@uni.edu", queryId: [queryId, queryId] },
    { email: "a@uni.edu", queryId: { id: queryId } },
  ]) {
    const res = await registerJson(body, ip);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  // A repeated ?queryId= is ignored in favour of the body copy.
  const repeated = await registerJson(
    { email: "a@uni.edu", queryId },
    ip,
    `?queryId=${encodeURIComponent(queryId)}&queryId=x`,
  );
  assert.equal(repeated.status, 200);
  assert.equal(tables.emailMappings.get(queryId).emails.length, 1);
});

test("index.js keeps the wiring this suite copies", () => {
  // index.js listens on load and cannot be required here, so guard the three
  // lines the /email limits depend on.
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "index.js"),
    "utf8",
  );
  assert.match(source, /^app\.set\("trust proxy", "loopback"\);$/m);
  assert.match(source, /^app\.use\(express\.json\(\)\);$/m);
  assert.doesNotMatch(source, /^\s*app\.use\(express\.urlencoded/m);
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

test("accepts the address in the JSON body", async () => {
  const queryId = queryIdFor("json-body");
  const res = await registerJson({ email: "body@uni.edu", queryId }, freshIp());
  assert.equal(res.status, 200);
  await runSearch("json-body");
  assert.deepEqual(sent.map((m) => m.to), ["body@uni.edu"]);
});

test("rejects an address sent only in the URL or as a form post", async () => {
  const queryId = queryIdFor("query-form");
  const urlOnly = await fetch(
    `${baseUrl}/email?email=qs@uni.edu&queryId=${encodeURIComponent(queryId)}`,
    { method: "POST", headers: { "X-Forwarded-For": freshIp() } },
  );
  assert.equal(urlOnly.status, 400);

  const formBody = new URLSearchParams({ email: "form@uni.edu", queryId });
  const formPost = await fetch(`${baseUrl}/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://evil.example",
      "X-Forwarded-For": freshIp(),
    },
    body: formBody.toString(),
  });
  assert.equal(formPost.status, 400);

  // text/plain is the other body type a page can send without a preflight.
  const textPost = await fetch(`${baseUrl}/email`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", "X-Forwarded-For": freshIp() },
    body: JSON.stringify({ email: "text@uni.edu", queryId }),
  });
  assert.equal(textPost.status, 400);

  await runSearch("query-form");
  assert.equal(sent.length, 0);
  assert.equal(tables.emailMappings.has(queryId), false);
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

test("matches searches the current frontend sends without URL encoding", async () => {
  // The deployed frontend interpolates the raw term into both URLs, so "+"
  // reaches the backend as a space in /search and in ?queryId=, while the JSON
  // body keeps the "+". The registration has to follow the URL copy.
  for (const term of ["disney+", "c++ compiler", "50% off"]) {
    sent.length = 0;
    const queryId = `c:US_t:${term}_p:false`;
    const res = await registerJson(
      { email: "first+tag@uni.edu", queryId },
      freshIp(),
      `?email=first+tag@uni.edu&queryId=${queryId}`,
    );
    assert.equal(res.status, 200);
    const search = await fetch(
      `${baseUrl}/api/search?query=${term}&includePermissions=false&countryCode=US`,
    );
    assert.equal(search.status, 200);
    assert.deepEqual(
      sent.map((m) => m.to),
      ["first+tag@uni.edu"],
      `no mail for ${JSON.stringify(term)}`,
    );
  }
});

test("tells the registrant when the search fails", async () => {
  const query = "sleep tracker";
  const queryId = queryIdFor(query);
  assert.equal(
    (await registerJson({ email: "alice@uni.edu", queryId }, freshIp())).status,
    200,
  );
  storeMode = "throttled";
  assert.equal((await runSearch(query)).status, 500);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "alice@uni.edu");
  assert.match(sent[0].subject, /could not be completed/);
  assert.equal(sent[0].attachments, undefined);
  assert.equal(tables.emailMappings.has(queryId), false);
});

test("tells the registrant when the search finds no apps", async () => {
  const query = "sleep tracker";
  const queryId = queryIdFor(query);
  assert.equal(
    (await registerJson({ email: "alice@uni.edu", queryId }, freshIp())).status,
    200,
  );
  storeMode = "empty";
  const response = await runSearch(query);
  assert.equal(typeof response.status, "number");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "alice@uni.edu");
  assert.equal(tables.emailMappings.has(queryId), false);
});

test("a failed search consumes the registration", async () => {
  const query = "sleep tracker";
  assert.equal(
    (
      await registerJson(
        { email: "alice@uni.edu", queryId: queryIdFor(query) },
        freshIp(),
      )
    ).status,
    200,
  );
  storeMode = "throttled";
  assert.equal((await runSearch(query)).status, 500);
  sent.length = 0;
  advanceClock(20 * HOUR);
  storeMode = "ok";
  assert.equal((await runSearch(query)).status, 200);
  assert.equal(sent.length, 0);
});

test("an expired registration gets no failure mail", async () => {
  const query = "sleep tracker";
  const queryId = queryIdFor(query);
  assert.equal(
    (await registerJson({ email: "alice@uni.edu", queryId }, freshIp())).status,
    200,
  );
  advanceClock(25 * HOUR);
  storeMode = "throttled";
  assert.equal((await runSearch(query)).status, 500);
  assert.equal(sent.length, 0);
  assert.equal(tables.emailMappings.has(queryId), false);
});

test("failure mail errors do not log the recipient address", async () => {
  const address = "private.failure@uni.edu";
  console.log.mock.resetCalls();
  console.error.mock.resetCalls();
  failSends = true;
  const query = "failure log check";
  const queryId = queryIdFor(query);
  assert.equal(
    (await registerJson({ email: address, queryId }, freshIp())).status,
    200,
  );
  storeMode = "throttled";
  assert.equal((await runSearch(query)).status, 500);
  assert.equal(sent.length, 1);
  const logged = [...console.log.mock.calls, ...console.error.mock.calls]
    .flatMap((call) => call.arguments)
    .map((value) =>
      typeof value === "string" ? value : JSON.stringify(value) + String(value),
    )
    .join("\n");
  assert.ok(!logged.includes(address), "address appeared in a log line");
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
