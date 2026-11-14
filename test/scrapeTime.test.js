const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Stub app-store-scraper so the test never hits the App Store.
const scraperPath = require.resolve('app-store-scraper');
const fakeApp = { id: 1, appId: 'com.example.app', title: 'Example App', description: 'Text' };
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

const { jsonToCsv, recordScrapeTime } = require(path.join(__dirname, '..', 'utilities', 'jsonToCsv'));
const listController = require(path.join(__dirname, '..', 'controllers', 'listController'));
// searchController and routes/searchRoutes require each other; index.js loads the
// route first, so do the same here.
require(path.join(__dirname, '..', 'routes', 'searchRoutes'));
const searchController = require(path.join(__dirname, '..', 'controllers', 'searchController'));

const makeReq = (query) => ({ query, method: 'GET', headers: {} });
const makeRes = () => {
  const res = { headers: {}, statusCode: 200, body: undefined };
  res.set = (k, v) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.setHeader = res.set;
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (body) => {
    res.body = body;
    return res;
  };
  res.json = res.send;
  res.end = () => res;
  return res;
};

const call = async (handler, query) => {
  const res = makeRes();
  await handler(makeReq(query), res);
  assert.strictEqual(res.statusCode, 200);
  return res.body;
};

const dateScrapedOf = (csv) => {
  const [header, row] = csv.split('\n');
  const index = header.split(',').indexOf('"dateScraped"');
  return row.split(',')[index].replace(/"/g, '');
};

const SCRAPED_AT = new Date('2026-11-14T10:00:00.000Z');
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

test('jsonToCsv stamps rows with their recorded scrape time', () => {
  const rows = recordScrapeTime([{ id: 1 }], SCRAPED_AT);
  assert.strictEqual(dateScrapedOf(jsonToCsv(rows, 'app')), SCRAPED_AT.toISOString());
});

test('search CSV and relog keep the scrape time and the stored row count', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SCRAPED_AT });
  const query = { query: 'com.example.app', countryCode: 'us' };
  await call(searchController.search, query);

  t.mock.timers.tick(THREE_DAYS_MS); // the download happens days later
  const csv = await call(searchController.downloadCSV, query);
  assert.strictEqual(dateScrapedOf(csv), SCRAPED_AT.toISOString());

  // totalCount is whatever the browser sends; the log reports what is stored
  const log = await call(searchController.downloadRelog, { ...query, store: 'iOS App Store', totalCount: '99' });
  assert.ok(log.includes(`date_time: ${SCRAPED_AT}`), log);
  assert.match(log, /^num_results: 1$/m);
});

test('top-chart CSV keeps the scrape time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SCRAPED_AT });
  await call(listController.scrapeList, {
    collection: 'topfreeapplications',
    category: '6005',
    categoryName: 'SOCIAL_NETWORKING',
    country: 'us',
  });

  t.mock.timers.tick(THREE_DAYS_MS);
  const csv = await call(listController.downloadTopChartsCSV, { query: 'topfreeapplicationsSOCIAL_NETWORKINGus' });
  assert.strictEqual(dateScrapedOf(csv), SCRAPED_AT.toISOString());
});
