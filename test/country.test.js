// Country validation on /search, /toplists and /reviews. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./support/server');

let server;
test.before(async () => {
  server = await startServer();
});
test.after(() => server.stop());

const scraperCalls = () => server.count(/\[STUB\] scraper call:/g);

test('unsupported countries return 400 without calling the scraper', async () => {
  const requests = [
    (country) => `/search?query=com.burbn.instagram${country === undefined ? '' : `&countryCode=${country}`}`,
    (country) => `/toplists?collection=topfreeapplications&category=6005&categoryName=SOCIAL_NETWORKING${country === undefined ? '' : `&country=${country}`}`,
    (country) => `/reviews?appId=com.burbn.instagram${country === undefined ? '' : `&countryCode=${country}`}`,
  ];

  for (const request of requests) {
    for (const country of ['AF', 'ZZ', 'NOPE', 'constructor', '143441']) {
      const before = scraperCalls();
      const res = await fetch(`${server.base}${request(country)}`);
      assert.equal(res.status, 400, `country=${country}`);
      assert.deepEqual(await res.json(), { error: 'Unsupported App Store country.' });
      assert.equal(scraperCalls(), before, 'the scraper must not be called for an unsupported country');
    }

    // No country (or an empty one) is the library's own US default, as before.
    for (const country of [undefined, '']) {
      const res = await fetch(`${server.base}${request(country)}`);
      assert.equal(res.status, 200, `country=${country}`);
    }
  }
});

test('supported countries work and retain the requested case', async () => {
  for (const country of ['gb', 'GB']) {
    const res = await fetch(`${server.base}/search?query=com.burbn.instagram&countryCode=${country}`);
    assert.equal(res.status, 200, `countryCode=${country}`);
    assert.equal((await res.json()).results[0].country, country);
  }

  const toplists = await fetch(
    `${server.base}/toplists?collection=topfreeapplications&category=6005&categoryName=SOCIAL_NETWORKING&country=JP`
  );
  assert.equal(toplists.status, 200);

  const reviews = await fetch(`${server.base}/reviews?appId=com.burbn.instagram&countryCode=us`);
  assert.equal(reviews.status, 200);
});

test('isSupportedCountry accepts only own App Store market codes', () => {
  const { isSupportedCountry } = require('../utilities/country');
  for (const country of ['us', 'US', 'gb']) assert.equal(isSupportedCountry(country), true, country);
  for (const country of ['AF', 'USA', '', undefined, null, 143441, '__proto__', 'toString']) {
    assert.equal(isSupportedCountry(country), false, String(country));
  }
});
