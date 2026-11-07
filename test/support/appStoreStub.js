// Preloaded into the server under test with `node -r`. Replaces every
// app-store-scraper call the backend makes with canned data so tests never
// reach the App Store, and logs each call so a test can count them.
//   APP_STORE_STUB=down -> every scraper call throws (simulated store outage)
const store = require('app-store-scraper');

const INSTAGRAM = { id: 389801252, appId: 'com.burbn.instagram', title: 'Instagram', developer: 'Instagram, Inc.' };
const UNRELATED = { id: 1000000001, appId: 'com.example.unrelated', title: 'Unrelated Keyword Hit', developer: 'Example' };
const NO_DETAILS = { id: 1000000002, appId: 'com.example.nodetails', title: 'No Details', developer: 'Example' };
const KNOWN = [INSTAGRAM, UNRELATED];

const handlers = {
  // Search terms drive the scenarios: 'zzznomatch' has no hits, 'detailsfail'
  // has a hit whose detail lookup fails, anything else has one keyword hit.
  search: ({ term }) => {
    if (term === 'zzznomatch') return [];
    if (term === 'detailsfail') return [{ ...NO_DETAILS }];
    return [{ ...UNRELATED }];
  },
  app: ({ id, appId }) => {
    const found = KNOWN.find((a) => (id ? String(a.id) === String(id) : a.appId === appId));
    if (!found) throw new Error('App not found (404)');
    return { ...found };
  },
  similar: () => [],
  reviews: () => [{ id: 'r1', title: 'Great', text: 'Works well', score: 5 }],
  list: () => [{ ...INSTAGRAM }, { ...UNRELATED }],
};

for (const [name, handler] of Object.entries(handlers)) {
  store[name] = async (opts = {}) => {
    console.log(`[STUB] scraper call: ${name} ${JSON.stringify(opts)}`);
    if (process.env.APP_STORE_STUB === 'down') {
      throw new Error('stubbed store outage');
    }
    return handler(opts);
  };
}
