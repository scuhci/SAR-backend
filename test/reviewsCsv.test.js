const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');

// Stub app-store-scraper so the test never hits the App Store.
const scraperPath = require.resolve('app-store-scraper');
const fakeReviews = [
  {
    id: '1',
    userName: 'Reviewer One',
    userUrl: 'https://itunes.apple.com/us/reviews/id111',
    version: '1.0',
    score: 5,
    title: 'Great',
    text: 'Love it',
    url: 'https://itunes.apple.com/us/review?id=1',
    updated: '2026-01-01T00:00:00-07:00',
  },
  {
    id: '2',
    userName: 'Reviewer Two',
    userUrl: 'https://itunes.apple.com/us/reviews/id222',
    version: '1.1',
    score: 2,
    title: 'Meh',
    text: 'Crashes',
    url: 'https://itunes.apple.com/us/review?id=2',
    updated: '2026-01-02T00:00:00-07:00',
  },
];
require.cache[scraperPath] = {
  id: scraperPath,
  filename: scraperPath,
  loaded: true,
  exports: {
    sort: { RECENT: 'mostRecent' },
    app: async () => ({ reviews: fakeReviews.length }),
    reviews: async () => fakeReviews,
  },
};

const { jsonToCsv } = require(path.join(__dirname, '..', 'utilities', 'jsonToCsv'));
const { scrapeReviews } = require(path.join(__dirname, '..', 'controllers', 'reviewsController'));

test('reviews CSV excludes reviewer name and profile URL', () => {
  const csv = jsonToCsv(fakeReviews.map((r) => ({ ...r, country: 'us' })), 'reviews');
  const header = csv.split('\n')[0];
  assert.ok(!header.includes('userUrl'), `header leaks userUrl: ${header}`);
  assert.ok(!header.includes('userName'), `header leaks userName: ${header}`);
  assert.ok(!csv.includes('apple.com/us/reviews/id'), 'row leaks reviewer profile URL');
  assert.ok(!csv.includes('Reviewer One'), 'row leaks reviewer name');
  assert.ok(header.includes('reviewID') && header.includes('reviewText'), header);
});

test('GET /reviews response has no reviewer profile URL column', async () => {
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
    assert.strictEqual(lines.length, 1 + fakeReviews.length);
    assert.ok(!lines[0].includes('userUrl'), `header leaks userUrl: ${lines[0]}`);
    assert.ok(!body.includes('apple.com/us/reviews/id'), 'CSV leaks reviewer profile URL');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
