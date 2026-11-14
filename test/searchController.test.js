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
  primaryEntries: null,
  related: () => [],
  onRelated: null,
  onApp: null,
  failApp: () => null, // (appId, attemptNumber) => Error | null
  searchCalls: [],
  probeRequestOptions: [],
  appCalls: [],
  appRequestOptions: [],
  inFlight: 0,
  maxInFlight: 0,
};

const entry = (appId) => ({ appId, title: `Title ${appId}`, summary: "s" });

gps.search = async (opts) => {
  store.searchCalls.push(opts);
  if (opts.term.startsWith("related to ")) {
    const term = opts.term.slice("related to ".length);
    if (store.onRelated) await store.onRelated(term);
    return store.related(term);
  }
  return store.primaryEntries ?? store.primary.map(entry);
};

gps.app = async (opts) => {
  // The controller first probes the query itself as an app ID; a keyword
  // is not one.
  if (!opts.appId.startsWith("com.")) {
    store.probeRequestOptions.push(opts.requestOptions);
    const notFound = new Error("App not found (404)");
    notFound.status = 404;
    throw notFound;
  }
  store.appCalls.push(opts.appId);
  store.appRequestOptions.push(opts.requestOptions);
  if (store.onApp) await store.onApp(opts.appId);
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
  store.permissionRequestOptions.push(opts.requestOptions);
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
const connectionDropped = () =>
  new Error("Error requesting Google Play:socket hang up");
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

const reset = ({
  primary,
  primaryEntries = null,
  related = () => [],
  onRelated = null,
  onApp = null,
  failApp = () => null,
}) => {
  Object.assign(store, {
    primary,
    primaryEntries,
    related,
    onRelated,
    onApp,
    failApp,
    searchCalls: [],
    probeRequestOptions: [],
    appCalls: [],
    appRequestOptions: [],
    inFlight: 0,
    maxInFlight: 0,
    permissionCalls: [],
    permissionRequestOptions: [],
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

const adjustableDateNow = (t) => {
  const realDateNow = Date.now;
  let offset = 0;
  Date.now = () => realDateNow() + offset;
  t.after(() => {
    Date.now = realDateNow;
  });
  return (ms) => {
    offset += ms;
  };
};

test("N-DATA-01: featured primary card recovers its app ID", async (t) => {
  t.after(quiet());
  reset({
    primary: [],
    primaryEntries: [
      {
        title: "Spotify: Music and Podcasts",
        url: "https://play.google.com/store/apps/details?id=com.spotify.music",
        summary: "s",
      },
      entry("com.spotify.kids"),
    ],
  });
  const res = await runSearch("spotify");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(ids(res), ["com.spotify.kids", "com.spotify.music"]);
  assert.equal(res.body.totalCount, 2);
  assert.equal(res.body.partial, false);
  assert.deepEqual(res.body.failedAppIds, []);
});

test("N-DATA-01: recovered primary card deduplicates against related results", async (t) => {
  t.after(quiet());
  reset({
    primary: [],
    primaryEntries: [
      {
        title: "Spotify: Music and Podcasts",
        url: "https://play.google.com/store/apps/details?id=com.spotify.music",
        summary: "s",
      },
    ],
    related: () => [entry("com.spotify.music")],
  });
  const res = await runSearch("spotify");
  assert.equal(res.statusCode, 200);
  assert.equal(
    store.appCalls.filter((id) => id === "com.spotify.music").length,
    1,
  );
});

test("N-DATA-01: entries without recoverable app IDs are reported as failures", async (t) => {
  t.after(quiet());
  reset({
    primary: [],
    primaryEntries: [
      {
        title: "Mystery App",
        url: "https://play.google.com/store/apps/dev?id=",
        summary: "s",
      },
      { title: "No Link" },
      entry("com.ok"),
    ],
  });
  const res = await runSearch("unknown apps");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(ids(res), ["com.ok"]);
  assert.equal(res.body.partial, true);
  assert.deepEqual(res.body.failedAppIds, [
    "https://play.google.com/store/apps/dev?id=",
    "No Link",
  ]);
  assert.deepEqual(store.appCalls, ["com.ok"]);
  assert.match(runRelog("unknown apps").body, /^num_failed: 2$/m);
});

test("GSR-02: an app whose detail fetch fails transiently is retried and kept", async (t) => {
  t.after(quiet());
  reset({
    primary: ["com.a", "com.b", "com.c"],
    failApp: (id, attempt) =>
      id === "com.b" && attempt === 1 ? connectionDropped() : null,
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
  // Parse failures stop after one attempt; throttling gets three attempts.
  assert.equal(store.appCalls.filter((id) => id === "com.b").length, 1);
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
  assert.match(res.body.error, /did not return details/);
  assert.equal(res.body.partial, true);
  assert.deepEqual([...res.body.failedAppIds].sort(), ["com.a", "com.b"]);
});

test("GSR-02: a clean search reports partial: false and the relog says none failed", async (t) => {
  t.after(quiet());
  reset({ primary: ["com.a"] });
  const res = await runSearch("clean");
  assert.equal(res.body.partial, false);
  assert.deepEqual(res.body.failedAppIds, []);
  assert.deepEqual(res.body.permissionsFailedAppIds, []);
  assert.equal(res.body.relatedSearchesMissed, 0);
  const relog = runRelog("clean").body;
  assert.match(relog, /^num_failed: 0$/m);
  assert.match(relog, /^num_permissions_failed: 0$/m);
  assert.match(relog, /^permissions_failed_app_ids: none$/m);
  assert.match(relog, /^num_related_searches_missed: 0$/m);
});

test("GSR-03: all search and app-ID probe calls receive bounded request options", async (t) => {
  t.after(quiet());
  reset({ primary: ["com.a"], related: () => [entry("com.b")] });
  const res = await runSearch("options");
  assert.equal(res.statusCode, 200);
  assert.ok(store.searchCalls.length > 1);
  for (const call of store.searchCalls) {
    assert.deepEqual(call.requestOptions, { timeout: 20000, retry: 0 });
  }
  assert.deepEqual(store.probeRequestOptions, [
    { timeout: 20000, retry: 0 },
  ]);
});

test("GSR-03: related searches stop after their budget and report misses", async (t) => {
  t.after(quiet());
  const advance = adjustableDateNow(t);
  let relatedCalls = 0;
  reset({
    primary: ["com.a", "com.b", "com.c"],
    onRelated: () => {
      relatedCalls++;
      if (relatedCalls === 1) advance(121 * 1000);
    },
  });
  const res = await runSearch("related budget");
  assert.equal(res.statusCode, 200);
  assert.equal(relatedCalls, 1);
  assert.deepEqual(ids(res), ["com.a", "com.b", "com.c"]);
  assert.equal(res.body.relatedSearchesMissed, 2);
  assert.equal(res.body.partial, true);
  assert.match(runRelog("related budget").body, /^num_related_searches_missed: 2$/m);
});

test("GSR-03: failed related searches are counted as misses", async (t) => {
  t.after(quiet());
  reset({
    primary: ["com.a", "com.b"],
    related: (title) => {
      if (title === "Title com.a") throw new Error("related search failed");
      return [];
    },
  });
  const res = await runSearch("related failure");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.relatedSearchesMissed, 1);
  assert.equal(res.body.partial, true);
});

test("GSR-03: an expired search budget reports detail fetches left out of time", async (t) => {
  t.after(quiet());
  const advance = adjustableDateNow(t);
  reset({
    primary: ["com.a"],
    onRelated: () => advance(201 * 1000),
  });
  const res = await runSearch("time budget");
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /ran out of time/);
  assert.deepEqual(res.body.failedAppIds, ["com.a"]);
  assert.deepEqual(store.appCalls, []);
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

test("GSR-03: detail and permission calls carry bounded request options", async (t) => {
  t.after(quiet());
  reset({ primary: ["com.a", "com.b", "com.c"] });
  const res = await runSearch("detail permission options", "true");
  assert.equal(res.statusCode, 200);
  assert.equal(store.appRequestOptions.length, 3);
  assert.equal(store.permissionRequestOptions.length, 3);
  for (const requestOptions of store.appRequestOptions) {
    assert.deepEqual(requestOptions, { timeout: 20000, retry: 0 });
  }
  for (const requestOptions of store.permissionRequestOptions) {
    assert.deepEqual(requestOptions, { timeout: 20000, retry: 0 });
  }
});

test("GSR-03: detail phase stops starting requests after its budget expires", async (t) => {
  t.after(quiet());
  const advance = adjustableDateNow(t);
  let advanced = false;
  const primary = Array.from({ length: 12 }, (_, i) => `com.p${i}`);
  reset({
    primary,
    onApp: () => {
      if (!advanced) {
        advanced = true;
        advance(201 * 1000);
      }
    },
  });
  const res = await runSearch("detail deadline");
  assert.equal(res.statusCode, 200);
  assert.ok(store.appCalls.length <= 4);
  assert.ok(store.appCalls.every((id) => ids(res).includes(id)));
  assert.ok(store.appCalls.length >= 1);
  assert.equal(res.body.results.length + res.body.failedAppIds.length, 12);
  assert.ok(res.body.failedAppIds.length >= 8);
  assert.equal(res.body.partial, true);
});

test("GSR-03: expired detail budget prevents permission requests", async (t) => {
  t.after(quiet());
  const advance = adjustableDateNow(t);
  const primary = ["com.a", "com.b", "com.c"];
  reset({
    primary,
    onApp: (appId) => {
      if (appId === primary[primary.length - 1]) advance(201 * 1000);
    },
  });
  const res = await runSearch("permission deadline", "true");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.results.length, 3);
  assert.deepEqual(store.permissionCalls, []);
  assert.ok(res.body.results.every((result) => result.permissionsFetchFailed === true));
  assert.ok(res.body.results.every((result) =>
    result.permissions.every((permission) => permission.isPermissionRequired === null),
  ));
  assert.deepEqual(res.body.permissionsFailedAppIds, primary);
  assert.equal(res.body.partial, true);
  assert.deepEqual(res.body.failedAppIds, []);
});
