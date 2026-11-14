// google-play-scraper 9.2.0 reads an app's categories with
// extractCategories(R.path([118], data)). Some store pages have no entry there,
// so the helper is called with undefined and throws "Cannot read properties of
// undefined (reading 'length')", which fails the whole gplay.app() call for an
// otherwise normal app. Upstream's 10.x function checks for an array at every
// recursion level; 10.x is ESM-only, so apply that function here instead.
// app.js looks the helper up on the shared module object at call time, so
// replacing the export is enough and affects every gplay.app() call in the process.
const helper = require("google-play-scraper/lib/utils/mappingHelpers");

if (typeof helper.extractCategories === "function" && !helper.extractCategories.missingArrayGuard) {
    function extractCategories(searchArray, categories = []) {
        if (!Array.isArray(searchArray) || searchArray.length === 0) return categories;
        if (searchArray.length >= 4 && typeof searchArray[0] === "string") {
            categories.push({ name: searchArray[0], id: searchArray[2] });
        } else {
            searchArray.forEach((sub) => extractCategories(sub, categories));
        }
        return categories;
    }
    extractCategories.missingArrayGuard = true;
    helper.extractCategories = extractCategories;
}

module.exports = helper;
