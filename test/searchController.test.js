// Keyword search in controllers/searchController.js with google-play-scraper
// stubbed, so no store traffic happens here.
const test = require("node:test");
const assert = require("node:assert/strict");

const gps = require("google-play-scraper");

// The controller sleeps 3 s per primary result, and retries back off for a
// second or more. Shrink those delays so the suite runs in well under a second.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) =>
  realSetTimeout(fn, ms >= 100 ? 1 : ms, ...args);

// Per-test stub configuration.
const store = {
  primary: [],
  related: () => [],
  failApp: () => null, // (appId, attemptNumber) => Error | null
  appCalls: [],
  inFlight: 0,
  maxInFlight: 0,
};

const entry = (appId) => ({ appId, title: `Title ${appId}`, summary: "s" });

gps.search = async (opts) =>
  opts.term.startsWith("related to ")
    ? store.related(opts.term.slice("related to ".length))
    : store.primary.map(entry);

gps.app = async (opts) => {
  // The controller first probes the query itself as an app ID; a keyword
  // is not one.
  if (!opts.appId.startsWith("com.")) {
    const notFound = new Error("App not found (404)");
    notFound.status = 404;
    throw notFound;
  }
  store.appCalls.push(opts.appId);
  store.inFlight++;
  store.maxInFlight = Math.max(store.maxInFlight, store.inFlight);
  try {
    await new Promise((resolve) => realSetTimeout(resolve, 2));
    const attempt = store.appCalls.filter((id) => id === opts.appId).length;
    const error = store.failApp(opts.appId, attempt);
    if (error) throw error;
    return { appId: opts.appId, title: `Title ${opts.appId}`, genre: "Tools" };
  } finally {
    store.inFlight--;
  }
};
gps.permissions = async (opts) => {
  store.permissionCalls.push(opts.appId);
  store.permissionsInFlight++;
  store.maxPermissionsInFlight = Math.max(
    store.maxPermissionsInFlight,
    store.permissionsInFlight,
  );
  try {
    await new Promise((resolve) => realSetTimeout(resolve, 2));
    return [];
  } finally {
    store.permissionsInFlight--;
  }
};

// Same load order as index.js (routes <-> controller require cycle).
require("../routes/searchRoutes");
const controller = require("../controllers/searchController");

const parseFailure = () =>
  new TypeError("Cannot read properties of undefined (reading 'length')");
const rateLimited = () => {
  const error = new Error("Error requesting Google Play:Response code 429");
  error.status = 429;
  return error;
};
const notFound = () => {
  const error = new Error("App not found (404)");
  error.status = 404;
  return error;
};

const fakeRes = () => ({
  statusCode: 200,
  headers: {},
  set() {
    return this;
  },
  setHeader(name, value) {
    this.headers[name] = value;
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

const reset = ({ primary, related = () => [], failApp = () => null }) => {
  Object.assign(store, {
    primary,
    related,
    failApp,
    appCalls: [],
    inFlight: 0,
    maxInFlight: 0,
    permissionCalls: [],
    permissionsInFlight: 0,
    maxPermissionsInFlight: 0,
  });
};

const query = (q, includePermissions = "false") => ({
  query: q,
  countryCode: "US",
  includePermissions,
});

const runSearch = async (q, includePermissions) => {
  const res = fakeRes();
  await controller.search(
    { headers: {}, method: "GET", query: query(q, includePermissions) },
    res,
  );
  return res;
};

const runRelog = (q) => {
  const res = fakeRes();
  controller.downloadRelog(
    { headers: {}, method: "GET", query: { ...query(q), totalCount: "1" } },
    res,
  );
  return res;
};

const ids = (res) => res.body.results.map((r) => r.appId).sort();

const quiet = () => {
  const saved = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = () => {};
  return () => ([console.log, console.error, console.warn] = saved);
};

test("GSR-02: an app whose detail fetch fails transiently is retried and kept", async (t) => {
  t.after(quiet());
  reset({
    primary: ["com.a", "com.b", "com.c"],
    failApp: (id, attempt) => (id === "com.b" && attempt === 1 ? parseFailure() : null),
  });
  const res = await runSearch("transient");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(ids(res), ["com.a", "com.b", "com.c"]);
  assert.equal(res.body.totalCount, 3);
  assert.equal(res.body.partial, false);
  assert.deepEqual(res.body.failedAppIds, []);
});

test("GSR-02: apps that keep failing are reported, not silently dropped", async (t) => {
  t.after(quiet());
  reset({
    primary: ["com.a", "com.b", "com.c", "com.d"],
    failApp: (id) =>
      id === "com.b" ? parseFailure() : id === "com.d" ? rateLimited() : null,
  });
  const res = await runSearch("persistent");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(ids(res), ["com.a", "com.c"]);
  assert.equal(res.body.totalCount, 2);
  assert.equal(res.body.partial, true);
  assert.deepEqual([...res.body.failedAppIds].sort(), ["com.b", "com.d"]);
  // three attempts each, then give up
  assert.equal(store.appCalls.filter((id) => id === "com.b").length, 3);
  assert.equal(store.appCalls.filter((id) => id === "com.d").length, 3);

  const relog = runRelog("persistent");
  assert.match(relog.body, /^num_failed: 2$/m);
  assert.match(relog.body, /^failed_app_ids: .*com\.b/m);
});

test("GSR-02: a 404 is final and is not retried", async (t) => {
  t.after(quiet());
  reset({
    primary: ["com.a", "com.gone"],
    failApp: (id) => (id === "com.gone" ? notFound() : null),
  });
  const res = await runSearch("notfound");
  assert.equal(store.appCalls.filter((id) => id === "com.gone").length, 1);
  assert.deepEqual(res.body.failedAppIds, ["com.gone"]);
  assert.equal(res.body.partial, true);
});

test("GSR-02: when every detail fetch fails the search answers 502 with the ids", async (t) => {
  t.after(quiet());
  reset({ primary: ["com.a", "com.b"], failApp: () => rateLimited() });
  const res = await runSearch("alldown");
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.partial, true);
  assert.deepEqual([...res.body.failedAppIds].sort(), ["com.a", "com.b"]);
});

test("GSR-02: a clean search reports partial: false and the relog says none failed", async (t) => {
  t.after(quiet());
  reset({ primary: ["com.a"] });
  const res = await runSearch("clean");
  assert.equal(res.body.partial, false);
  assert.deepEqual(res.body.failedAppIds, []);
  assert.match(runRelog("clean").body, /^num_failed: 0$/m);
});

test("GSR-03: each distinct app is fetched once, at most 4 requests at a time", async (t) => {
  t.after(quiet());
  const primary = Array.from({ length: 12 }, (_, i) => `com.p${i}`);
  reset({
    primary,
    // every related list repeats the primaries plus a shared app
    related: () => [...primary, "com.shared"].map(entry),
  });
  const res = await runSearch("burst");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalCount, 13);
  assert.equal(store.appCalls.length, 13);
  assert.equal(new Set(store.appCalls).size, 13);
  assert.ok(store.maxInFlight <= 4, `max in flight was ${store.maxInFlight}`);
  assert.ok(store.maxInFlight > 1, "requests should still run in parallel");
});

test("GSR-03: permission lookups are bounded to 4 at a time", async (t) => {
  t.after(quiet());
  reset({ primary: Array.from({ length: 10 }, (_, i) => `com.p${i}`) });
  const res = await runSearch("perms", "true");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalCount, 10);
  assert.equal(store.permissionCalls.length, 10);
  assert.ok(store.maxPermissionsInFlight <= 4, `max was ${store.maxPermissionsInFlight}`);
});
