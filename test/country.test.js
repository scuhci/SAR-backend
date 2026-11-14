// Country handling across /search, /toplists, and /reviews. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./support/server');

let server;
test.before(async () => {
  server = await startServer();
});
test.after(() => server.stop());

const scraperCalls = () => server.count(/\[STUB\] scraper call:/g);
const scraperCallsFor = (name) => server.count(new RegExp(`\\[STUB\\] scraper call: ${name} `, 'g'));

test('toplists rejects unsupported countries without calling the scraper', async () => {
  for (const country of ['AF', 'ZZ', 'NOPE', 'constructor', '143441']) {
    const before = scraperCalls();
    const res = await fetch(
      `${server.base}/toplists?collection=topfreeapplications&category=6005&categoryName=SOCIAL_NETWORKING&country=${country}`
    );
    assert.equal(res.status, 400, `country=${country}`);
    assert.deepEqual(await res.json(), { error: 'Unsupported App Store country.' });
    assert.equal(scraperCalls(), before, 'the scraper must not be called for an unsupported country');
  }

  for (const country of [undefined, '']) {
    const query = country === undefined ? '' : '&country=';
    const res = await fetch(
      `${server.base}/toplists?collection=topfreeapplications&category=6005&categoryName=SOCIAL_NETWORKING${query}`
    );
    assert.equal(res.status, 200, `country=${country}`);
  }
});

test('/reviews passes unsupported countries through to the scraper', async () => {
  for (const country of ['RS', 'rs', 'AF']) {
    const before = server.count(
      new RegExp(`\\[STUB\\] scraper call: reviews [^\\n]*"country":"${country}"`, 'g')
    );
    const res = await fetch(
      `${server.base}/reviews?appId=com.burbn.instagram&countryCode=${country}`
    );
    assert.equal(res.status, 200, `countryCode=${country}`);
    assert.ok(
      server.count(new RegExp(`\\[STUB\\] scraper call: reviews [^\\n]*"country":"${country}"`, 'g')) > before,
      `reviews scraper should receive country=${country}`
    );
  }
});

test('/search allows unsupported countries for bundle-id and numeric-id lookups', async () => {
  for (const [query, country] of [
    ['com.burbn.instagram', 'RS'],
    ['389801252', 'rs'],
  ]) {
    const searchBefore = scraperCallsFor('search');
    const similarBefore = scraperCallsFor('similar');
    const res = await fetch(
      `${server.base}/search?query=${query}&countryCode=${country}`
    );
    assert.equal(res.status, 200, `query=${query}&countryCode=${country}`);
    const body = await res.json();
    assert.equal(body.results[0].appId, 'com.burbn.instagram');
    assert.equal(body.results[0].country, country);
    assert.equal(scraperCallsFor('search'), searchBefore, 'id lookup must skip keyword search');
    assert.equal(scraperCallsFor('similar'), similarBefore, 'id lookup must skip similar search');
  }
});

test('unsupported keyword searches return their specific error without keyword or similar calls', async () => {
  for (const country of ['RS', 'ZZ', 'NOPE']) {
    const searchBefore = scraperCallsFor('search');
    const similarBefore = scraperCallsFor('similar');
    const res = await fetch(
      `${server.base}/search?query=instagram&countryCode=${country}`
    );
    assert.equal(res.status, 400, `countryCode=${country}`);
    assert.deepEqual(await res.json(), {
      error: 'Keyword search is not available for this App Store country. Search by bundle id or App Store id instead.',
    });
    assert.equal(scraperCallsFor('search'), searchBefore, 'keyword search should not use the US fallback');
    assert.equal(scraperCallsFor('similar'), similarBefore, 'similar search should not run');
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
