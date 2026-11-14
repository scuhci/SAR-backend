// app-store-scraper falls back to the US storefront for any country missing
// from its markets table, so such a request would return US data labelled with
// the requested country. Read the table from lib/constants: tests replace the
// package's main module with partial stubs.
const { markets } = require('app-store-scraper/lib/constants');

const UNSUPPORTED_COUNTRY_ERROR = 'Unsupported App Store country.';

function isSupportedCountry(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(markets, value.toUpperCase());
}

module.exports = { isSupportedCountry, UNSUPPORTED_COUNTRY_ERROR };
