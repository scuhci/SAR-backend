// google-play-scraper 9.2.0 reads an app's categories with
// extractCategories(R.path([118], data)). Some store pages have no entry there,
// so the helper is called with undefined and throws "Cannot read properties of
// undefined (reading 'length')", which fails the whole gplay.app() call for an
// otherwise normal app. Upstream fixed this in 10.x by treating a missing array
// as "no categories"; 10.x is ESM-only, so apply the same guard here instead.
// app.js looks the helper up on the shared module object at call time, so
// replacing the export is enough and affects every gplay.app() call in the process.
const helper = require("google-play-scraper/lib/utils/mappingHelpers");

if (typeof helper.extractCategories === "function" && !helper.extractCategories.missingArrayGuard) {
    const original = helper.extractCategories;
    const guarded = (searchArray, categories = []) =>
        searchArray == null ? categories : original(searchArray, categories);
    guarded.missingArrayGuard = true;
    helper.extractCategories = guarded;
}

module.exports = helper;
