const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');

// Stub app-store-scraper so the test never hits the App Store.
// Pages 1 and 2 return 50 reviews each; every later page is empty.
const scraperPath = require.resolve('app-store-scraper');
const PAGE_SIZE = 50;
const LAST_PAGE_WITH_DATA = 2;
const pagesRequested = [];
const makePage = (page) =>
  Array.from({ length: PAGE_SIZE }, (_, i) => ({
    id: `p${page}-${i}`,
    userName: 'Reviewer',
    userUrl: 'https://itunes.apple.com/us/reviews/id1',
    version: '1.0',
    score: 5,
    title: 'Fine',
    text: 'Works',
    url: 'https://itunes.apple.com/us/review?id=1',
    updated: '2026-01-01T00:00:00-07:00',
  }));
require.cache[scraperPath] = {
  id: scraperPath,
  filename: scraperPath,
  loaded: true,
  exports: {
    sort: { RECENT: 'mostRecent' },
    app: async () => ({ reviews: 10000 }),
    reviews: async (options) => {
      pagesRequested.push(options.page);
      return options.page <= LAST_PAGE_WITH_DATA ? makePage(options.page) : [];
    },
  },
};

const { scrapeReviews } = require(path.join(__dirname, '..', 'controllers', 'reviewsController'));

test('reviews fetch stops paging after the store returns an empty page', async () => {
  const app = express();
  app.use('/reviews', scrapeReviews);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/reviews?appId=com.example.app&countryCode=us`);
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    const lines = body.split('\n');
    assert.strictEqual(lines.length, 1 + PAGE_SIZE * LAST_PAGE_WITH_DATA, 'all non-empty pages are returned');
    // Pages 1 and 2 have data, page 3 is the first empty page; nothing past it should be requested.
    assert.deepStrictEqual(pagesRequested, [1, 2, 3], `requested pages: ${pagesRequested}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
