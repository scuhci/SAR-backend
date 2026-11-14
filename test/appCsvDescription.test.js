const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');

// Stub app-store-scraper so the test never hits the App Store.
// The shape mirrors what app-store-scraper's cleanApp() returns: the only
// description field on iOS is `description` (there is no `summary`).
const scraperPath = require.resolve('app-store-scraper');
const fakeApp = {
  id: 389801252,
  appId: 'com.example.app',
  title: 'Example App',
  url: 'https://apps.apple.com/us/app/example/id389801252',
  description: 'Line one of the "best" description.\nLine two with <b>html</b> & stuff.',
  icon: 'https://example.com/icon.png',
  genres: ['Social Networking'],
  genreIds: ['6005'],
  primaryGenre: 'Social Networking',
  primaryGenreId: 6005,
  contentRating: '12+',
  languages: ['EN'],
  size: '123456',
  requiredOsVersion: '15.0',
  released: '2010-10-06T08:21:42Z',
  updated: '2026-01-01T00:00:00Z',
  releaseNotes: 'Bug fixes',
  version: '1.2.3',
  price: 0,
  currency: 'USD',
  free: true,
  developerId: 1,
  developer: 'Example Dev',
  developerUrl: 'https://apps.apple.com/us/developer/id1',
  developerWebsite: 'https://example.com',
  score: 4.5,
  reviews: 10,
  currentVersionScore: 4.5,
  currentVersionReviews: 10,
  screenshots: [],
  ipadScreenshots: [],
  appletvScreenshots: [],
  supportedDevices: ['iPhone'],
};
require.cache[scraperPath] = {
  id: scraperPath,
  filename: scraperPath,
  loaded: true,
  exports: {
    // keep the library's constants (collection, category, ...) and replace only the network calls
    ...require('app-store-scraper'),
    list: async () => [{ ...fakeApp }],
    search: async () => [{ ...fakeApp }],
    app: async () => ({ ...fakeApp }),
    similar: async () => [],
  },
};

const { jsonToCsv } = require(path.join(__dirname, '..', 'utilities', 'jsonToCsv'));
const listController = require(path.join(__dirname, '..', 'controllers', 'listController'));
// searchController and routes/searchRoutes require each other; index.js loads the
// route first, so do the same here.
require(path.join(__dirname, '..', 'routes', 'searchRoutes'));
const searchController = require(path.join(__dirname, '..', 'controllers', 'searchController'));

// The description as a correctly escaped CSV cell: quotes doubled once, newline flattened
const ESCAPED_DESCRIPTION =
  '"Line one of the ""best"" description. Line two with <b>html</b> & stuff."';

function parseHeader(csv) {
  return csv.split('\n')[0].split(',').map((c) => c.replace(/^"|"$/g, ''));
}

async function withServer(mount, fn) {
  const app = express();
  mount(app);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    // drop any request a handler never answered so a failure cannot hang the run
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('app CSV keeps the description column for App Store data', () => {
  const csv = jsonToCsv([{ ...fakeApp, country: 'us', source: 'primary search' }], 'app');
  const header = parseHeader(csv);
  assert.ok(header.includes('description'), `description column missing: ${header}`);
  assert.strictEqual(header.filter((c) => c === 'description').length, 1);
  assert.ok(header.includes('appName') && header.includes('avgRating'), header);
  // newlines are flattened and the text is otherwise unchanged
  assert.ok(csv.includes('Line one of the ""best"" description. Line two with <b>html</b> & stuff.'), csv);
});

test('GET /download-top-csv includes the description column', async () => {
  await withServer(
    (app) => {
      app.use('/toplists', listController.scrapeList);
      app.use('/download-top-csv', listController.downloadTopChartsCSV);
    },
    async (base) => {
      const query = 'toplists?collection=topfreeapplications&category=6005&categoryName=Social%20Networking&country=us';
      const listRes = await fetch(`${base}/${query}`);
      assert.strictEqual(listRes.status, 200);
      const listBody = await listRes.json();
      assert.strictEqual(listBody.results[0].description, fakeApp.description);

      const csvRes = await fetch(`${base}/download-top-csv?query=topfreeapplicationsSocial%20Networkingus`);
      assert.strictEqual(csvRes.status, 200);
      const csv = await csvRes.text();
      const header = parseHeader(csv);
      assert.ok(header.includes('description'), `description column missing: ${header}`);
      assert.ok(csv.includes(ESCAPED_DESCRIPTION), 'description text missing from CSV row');
    }
  );
});

test('GET /download-csv (keyword / app ID search) includes the description column', { timeout: 20000 }, async () => {
  await withServer(
    (app) => {
      app.get('/search', searchController.search);
      app.get('/download-csv', searchController.downloadCSV);
    },
    async (base) => {
      const searchRes = await fetch(`${base}/search?query=com.example.app&countryCode=us`);
      assert.strictEqual(searchRes.status, 200);
      const searchBody = await searchRes.json();
      assert.strictEqual(searchBody.totalCount, 1);
      // the JSON carries the text as the store returned it, quotes not doubled
      assert.strictEqual(searchBody.results[0].description, fakeApp.description);

      const csvRes = await fetch(`${base}/download-csv?query=com.example.app&countryCode=us`);
      assert.strictEqual(csvRes.status, 200);
      const csv = await csvRes.text();
      const header = parseHeader(csv);
      assert.ok(header.includes('description'), `description column missing: ${header}`);
      // each quote is doubled exactly once, the same as in the top-chart CSV
      assert.ok(csv.includes(ESCAPED_DESCRIPTION), `description cell is wrong: ${csv.split('\n')[1]}`);
    }
  );
});
