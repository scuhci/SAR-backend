// Permission lookups (controllers/permissionsController.js) and how a failed
// lookup reaches the search response, the top-charts response and the CSV.
// google-play-scraper is stubbed, so no store traffic happens here.
const test = require("node:test");
const assert = require("node:assert/strict");

const gps = require("google-play-scraper");

const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) =>
  realSetTimeout(fn, ms >= 100 ? 1 : ms, ...args);

const CAMERA = "take pictures and videos";
const permissionCalls = [];
// com.bad is throttled on every attempt; everything else requests the camera
gps.permissions = async (opts) => {
  permissionCalls.push(opts);
  if (opts.appId === "com.bad") {
    const error = new Error("Error requesting Google Play:Response code 429");
    error.status = 429;
    throw error;
  }
  return [{ permission: CAMERA, type: "Camera" }];
};
const entry = (appId) => ({ appId, title: `Title ${appId}`, summary: "s" });
gps.search = async (opts) =>
  opts.term.startsWith("related to") ? [] : [entry("com.good"), entry("com.bad")];
gps.app = async (opts) => {
  if (!opts.appId.startsWith("com.")) {
    throw Object.assign(new Error("App not found (404)"), { status: 404 });
  }
  return { appId: opts.appId, title: `Title ${opts.appId}` };
};
gps.list = async () => [entry("com.good"), entry("com.bad")];

require("../routes/searchRoutes");
const searchController = require("../controllers/searchController");
const listController = require("../controllers/listController");
const { fetchPermissions } = require("../controllers/permissionsController");
const standardPermissionsList = require("../controllers/permissionsConfig");

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

const quiet = () => {
  const saved = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = () => {};
  return () => ([console.log, console.error, console.warn] = saved);
};

const cellsFor = (results, appId) =>
  results
    .find((r) => r.appId === appId)
    .permissions.map((p) => p.isPermissionRequired);

test("GSR-10: a failed lookup is marked, not reported as an app with no permissions", async (t) => {
  t.after(quiet());
  const [good, bad] = await fetchPermissions([entry("com.good"), entry("com.bad")]);
  assert.deepEqual(good.permissions, [{ permission: CAMERA, type: "Camera" }]);
  assert.equal(good.permissionsFetchFailed, false);
  assert.equal(bad.permissions, null);
  assert.equal(bad.permissionsFetchFailed, true);
  // the library has no country option; nothing pretends to set one
  assert.ok(permissionCalls.every((opts) => !("country" in opts)));
});

test("GSR-10: search response and CSV leave failed permission cells empty", async (t) => {
  t.after(quiet());
  const query = { query: "perm", countryCode: "US", includePermissions: "true" };
  const res = fakeRes();
  await searchController.search({ headers: {}, method: "GET", query }, res);
  assert.equal(res.statusCode, 200);
  const goodCells = cellsFor(res.body.results, "com.good");
  assert.equal(goodCells.length, standardPermissionsList.length);
  assert.equal(goodCells[standardPermissionsList.indexOf(CAMERA)], true);
  assert.ok(goodCells.filter((v) => v === false).length > 0);
  assert.ok(cellsFor(res.body.results, "com.bad").every((v) => v === null));

  const csvRes = fakeRes();
  searchController.downloadCSV({ headers: {}, method: "GET", query }, csvRes);
  assert.equal(csvRes.statusCode, 200);
  const [header, ...rows] = csvRes.body.split("\n");
  const columns = header.split(",").map((c) => c.replace(/"/g, ""));
  const flagCol = columns.indexOf("permissionsFetchFailed");
  const cameraCol = columns.indexOf(CAMERA);
  assert.ok(flagCol >= 0 && cameraCol >= 0, header);
  const bad = rows.find((r) => r.includes("com.bad")).split(",");
  const good = rows.find((r) => r.includes("com.good")).split(",");
  assert.equal(bad[flagCol], '"true"');
  assert.equal(bad[cameraCol], "");
  assert.equal(good[flagCol], '"false"');
  assert.equal(good[cameraCol], "true");
});

test("GSR-10: top-charts response marks failed lookups as null too", async (t) => {
  t.after(quiet());
  const res = fakeRes();
  await listController.scrapeList(
    {
      headers: {},
      method: "GET",
      query: { collection: "TOP_FREE", category: "APPLICATION", country: "us", includePermissions: "true" },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(cellsFor(res.body.results, "com.good")[standardPermissionsList.indexOf(CAMERA)], true);
  assert.ok(cellsFor(res.body.results, "com.bad").every((v) => v === null));
});
