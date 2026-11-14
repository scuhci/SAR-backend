// CSV download endpoints with missing or unknown cache keys. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./support/server');

let server;
test.before(async () => {
  server = await startServer();
});
test.after(() => server.stop());

async function expectNotAvailable(url) {
  const res = await fetch(url);
  const text = await res.text();
  assert.equal(res.status, 404, text);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(JSON.parse(text), { error: 'CSV data not available.' });
}

// Must run first: it needs a process that has not scraped a top list yet.
test('/download-top-csv on a fresh process returns 404 JSON, not an HTML stack trace', async () => {
  await expectNotAvailable(`${server.base}/download-top-csv?query=anything&includePermissions=false`);
});

test('/download-top-csv with an unknown key after a scrape returns 404; a known key still downloads', async () => {
  const list = await fetch(
    `${server.base}/toplists?collection=topfreeapplications&category=6005&categoryName=SOCIAL_NETWORKING&country=us`
  );
  assert.equal(list.status, 200);

  await expectNotAvailable(`${server.base}/download-top-csv?query=doesnotexist&includePermissions=false`);

  const known = await fetch(
    `${server.base}/download-top-csv?query=topfreeapplicationsSOCIAL_NETWORKINGus&includePermissions=false`
  );
  assert.equal(known.status, 200);
  assert.match(known.headers.get('content-disposition'), /topfreeapplicationsSOCIAL_NETWORKINGus_.*\.csv/);
  assert.match(await known.text(), /Instagram/);
});

test('/download-csv with an unknown key after a search returns 404', async () => {
  const search = await fetch(`${server.base}/search?query=com.burbn.instagram&countryCode=us`);
  assert.equal(search.status, 200);

  await expectNotAvailable(`${server.base}/download-csv?query=neversearched&countryCode=gb`);

  const known = await fetch(`${server.base}/download-csv?query=com.burbn.instagram&countryCode=us`);
  assert.equal(known.status, 200);
  assert.match(await known.text(), /Instagram/);
});

// Depends on the search in the previous test having cached its result.
test('/download-csv sends a single Content-Type header', async () => {
  const http = require('node:http');
  const res = await new Promise((resolve, reject) => {
    http
      .get(`${server.base}/download-csv?query=com.burbn.instagram&countryCode=us`, (r) => {
        r.resume();
        r.on('end', () => resolve(r));
      })
      .on('error', reject);
  });
  assert.equal(res.statusCode, 200);
  const contentTypes = res.rawHeaders.filter((_, i) => i % 2 === 1 && /^content-type$/i.test(res.rawHeaders[i - 1]));
  assert.deepEqual(contentTypes, ['text/csv; charset=utf-8']);
});
