// google-play-scraper 9.2.0 fails gplay.app() for apps whose store page has no
// category array: extractCategories is called with undefined and reads .length.
// Keyword search must load the guard for that, or those apps are lost.
const test = require("node:test");
const assert = require("node:assert/strict");

const helper = require("google-play-scraper/lib/utils/mappingHelpers");
const unguarded = helper.extractCategories;

test("GSR-02: the library helper really throws on a page without categories", () => {
  assert.throws(() => unguarded(undefined), TypeError);
});

test("GSR-02: loading the search controller installs the category guard", () => {
  require("../routes/searchRoutes");
  require("../controllers/searchController");
  // app.js looks the helper up on this module object at call time
  assert.notEqual(helper.extractCategories, unguarded);
  assert.deepEqual(helper.extractCategories(undefined), []);
  assert.deepEqual(helper.extractCategories(null), []);
});

test("GSR-02: pages that do have categories are parsed as before", () => {
  const page = [["Tools", null, "TOOLS", null], [["Productivity", null, "PRODUCTIVITY", null]]];
  assert.deepEqual(helper.extractCategories(page), [
    { name: "Tools", id: "TOOLS" },
    { name: "Productivity", id: "PRODUCTIVITY" },
  ]);
});

test("GSR-02: loading the guard twice does not wrap it twice", () => {
  const first = helper.extractCategories;
  delete require.cache[require.resolve("../utilities/gplayCategoryGuard")];
  require("../utilities/gplayCategoryGuard");
  assert.equal(helper.extractCategories, first);
});
