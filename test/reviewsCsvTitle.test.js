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
    title: 'Great app',
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
    title: 'Keeps crashing',
    text: 'Crashes on launch',
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

function parseLine(line) {
  return line.split('","').map((cell) => cell.replace(/^"|"$/g, ''));
}

test('reviews CSV keeps the review title as a reviewTitle column', () => {
  const csv = jsonToCsv(fakeReviews.map((r) => ({ ...r, country: 'us' })), 'reviews');
  const lines = csv.split('\n');
  const header = parseLine(lines[0]);
  const titleIndex = header.indexOf('reviewTitle');
  assert.notStrictEqual(titleIndex, -1, `header has no reviewTitle column: ${lines[0]}`);
  assert.ok(!header.includes('title'), `raw title column should be renamed: ${lines[0]}`);
  assert.strictEqual(parseLine(lines[1])[titleIndex], 'Great app');
  assert.strictEqual(parseLine(lines[2])[titleIndex], 'Keeps crashing');
  // the rest of the header keeps its existing names
  assert.ok(header.includes('reviewID') && header.includes('reviewText') && header.includes('rating'), lines[0]);
});

test('GET /reviews response includes the reviewTitle column', async () => {
  const app = express();
  app.use('/reviews', scrapeReviews);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/reviews?appId=com.example.app&countryCode=us`);
    assert.strictEqual(res.status, 200);
    const lines = (await res.text()).split('\n');
    assert.strictEqual(lines.length, 1 + fakeReviews.length);
    const header = parseLine(lines[0]);
    const titleIndex = header.indexOf('reviewTitle');
    assert.notStrictEqual(titleIndex, -1, `header has no reviewTitle column: ${lines[0]}`);
    assert.strictEqual(parseLine(lines[1])[titleIndex], 'Great app');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
