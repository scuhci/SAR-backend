'use strict';

// Scraped result sets are kept in node-ttl stores so the CSV can be downloaded
// afterwards. On its own node-ttl only drops an expired entry when that same
// key is read again and has no size limit, so every chart and search ever
// requested stayed in memory until the process restarted. limitCache() adds
// the two missing pieces to a store: a periodic sweep of expired entries and a
// cap on the number of entries (the oldest one is dropped first).
const NodeTtl = require('node-ttl');

// One entry is a whole chart or search result (up to a few hundred app
// records), so the cap is kept small.
const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_SWEEP_MS = 60000;

function limitCache(store, { maxEntries = DEFAULT_MAX_ENTRIES, sweepMs = DEFAULT_SWEEP_MS } = {}) {
  // Keys in the order they were last pushed, oldest first
  const pushOrder = new Set();
  const hasKey = (key) => Object.prototype.hasOwnProperty.call(store._store, key);

  store.on('del', (key) => pushOrder.delete(key));
  store.on('clear', () => pushOrder.clear());

  const push = store.push.bind(store);
  store.push = (key, value, timeOutFunction, ttlSeconds) => {
    if (hasKey(key)) {
      pushOrder.delete(key);
    } else {
      while (store.size() >= maxEntries && pushOrder.size > 0) {
        store.del(pushOrder.values().next().value);
      }
    }
    const pushed = push(key, value, timeOutFunction, ttlSeconds);
    if (pushed) {
      pushOrder.add(key);
    }
    return pushed;
  };

  if (sweepMs > 0) {
    const sweep = setInterval(() => {
      for (const key of Object.keys(store._store)) {
        // _check() deletes the entry when its ttl has passed
        store._check(store._store[key]);
      }
    }, sweepMs);
    sweep.unref();
  }

  return store;
}

// A new store with the limits already applied
const createResultCache = (options) => limitCache(new NodeTtl(), options);

module.exports = { limitCache, createResultCache, DEFAULT_MAX_ENTRIES, DEFAULT_SWEEP_MS };
