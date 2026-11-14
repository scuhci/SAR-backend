// app-store-scraper's search(), list() and similar() fall back to the US
// storefront for a country missing from its markets table, so keyword searches
// and top charts for such a country would return US-store data labelled with
// the requested country. app() and reviews() send the country to Apple as given
// and are not affected. Read the table from lib/constants: tests replace the
// package's main module with partial stubs.
const { markets } = require('app-store-scraper/lib/constants');

const UNSUPPORTED_COUNTRY_ERROR = 'Unsupported App Store country.';
const KEYWORD_SEARCH_UNSUPPORTED_COUNTRY_ERROR = 'Keyword search is not available for this App Store country. Search by bundle id or App Store id instead.';

function isSupportedCountry(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(markets, value.toUpperCase());
}

module.exports = { isSupportedCountry, UNSUPPORTED_COUNTRY_ERROR, KEYWORD_SEARCH_UNSUPPORTED_COUNTRY_ERROR };
