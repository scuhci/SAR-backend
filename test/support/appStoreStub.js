// Preloaded into the server under test with `node -r`. Replaces every
// app-store-scraper call the backend makes with canned data so tests never
// reach the App Store, and logs each call so a test can count them.
//   APP_STORE_STUB=down -> every scraper call throws (simulated store outage)
//   APP_STORE_STUB=brokenlist -> GET /toplists throws before its try block (the
//     collection table cannot be enumerated), i.e. the async handler rejects
const store = require('app-store-scraper');

if (process.env.APP_STORE_STUB === 'brokenlist') {
  store.collection = new Proxy(store.collection, {
    ownKeys() {
      throw new Error('stubbed failure outside the handler try block');
    },
  });
}

const INSTAGRAM = { id: 389801252, appId: 'com.burbn.instagram', title: 'Instagram', developer: 'Instagram, Inc.' };
const FACEBOOK = { id: 284882215, appId: 'com.facebook.Facebook', title: 'Facebook', developer: 'Meta Platforms, Inc.' };
const UNRELATED = { id: 1000000001, appId: 'com.example.unrelated', title: 'Unrelated Keyword Hit', developer: 'Example' };
const NO_DETAILS = { id: 1000000002, appId: 'com.example.nodetails', title: 'No Details', developer: 'Example' };
const KNOWN = [INSTAGRAM, FACEBOOK, UNRELATED];
const META_DEVELOPER_ID = '284882218';

const handlers = {
  // Search terms drive the scenarios: 'zzznomatch' has no hits, 'detailsfail'
  // has a hit whose detail lookup fails, anything else has one keyword hit.
  search: ({ term }) => {
    if (term === 'zzznomatch') return [];
    if (term === 'detailsfail') return [{ ...NO_DETAILS }];
    return [{ ...UNRELATED }];
  },
  app: ({ id, appId }) => {
    // Apple answers a developer id with that developer's first app.
    if (String(id) === META_DEVELOPER_ID) return { ...FACEBOOK };
    const found = KNOWN.find((a) => (id ? String(a.id) === String(id) : a.appId === appId));
    if (!found) throw new Error('App not found (404)');
    return { ...found };
  },
  // The health monitor asks by id alone; /search always sends an appId and gets no related apps.
  similar: ({ id, appId }) => (id && !appId ? [{ ...UNRELATED }] : []),
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
