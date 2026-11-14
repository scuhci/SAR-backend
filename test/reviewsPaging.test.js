const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');

// Stub app-store-scraper so the test never hits the App Store.
// Each test sets pageSizes: the number of reviews on page 1, 2, ...; later pages are empty.
const scraperPath = require.resolve('app-store-scraper');
const PAGE_SIZE = 50;
const pagesRequested = [];
let pageSizes = [];
const makePage = (page, size) =>
  Array.from({ length: size }, (_, i) => ({
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
      const size = pageSizes[options.page - 1] || 0;
      return makePage(options.page, size);
    },
  },
};

const { scrapeReviews } = require(path.join(__dirname, '..', 'controllers', 'reviewsController'));

test.beforeEach(() => {
  pagesRequested.length = 0;
});

test('reviews fetch stops after two consecutive empty pages', async () => {
  pageSizes = [PAGE_SIZE, PAGE_SIZE];
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
    assert.strictEqual(lines.length, 1 + PAGE_SIZE * 2, 'all non-empty pages are returned');
    // Pages 1 and 2 have data; pages 3 and 4 are consecutive empties.
    assert.deepStrictEqual(pagesRequested, [1, 2, 3, 4], `requested pages: ${pagesRequested}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reviews fetch continues after one empty page in the middle', async () => {
  pageSizes = [PAGE_SIZE, PAGE_SIZE, 0, PAGE_SIZE, PAGE_SIZE, PAGE_SIZE, PAGE_SIZE, PAGE_SIZE, PAGE_SIZE, PAGE_SIZE];
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
    assert.strictEqual(lines.length, 1 + PAGE_SIZE * 9, 'all 450 reviews are returned with the header');
    assert.deepStrictEqual(pagesRequested, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], `requested pages: ${pagesRequested}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
