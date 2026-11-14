'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const test = require('node:test');
const { createResultCache, limitCache } = require('../utilities/resultCache');
const systemUptime = os.uptime;

// node-ttl reads os.uptime(); pin it so the tests control the clock.
os.uptime = () => 100;
test.after(() => {
  os.uptime = systemUptime;
});

test('evicts the oldest entries when the cache reaches its cap', () => {
  const cache = createResultCache({ maxEntries: 3 });

  for (let i = 1; i <= 5; i += 1) {
    assert.equal(cache.push(`k${i}`, `v${i}`, null, 604800), true);
  }

  assert.equal(cache.size(), 3);
  assert.equal(cache.get('k1'), null);
  assert.equal(cache.get('k2'), null);
  assert.equal(cache.get('k3'), 'v3');
  assert.equal(cache.get('k4'), 'v4');
  assert.equal(cache.get('k5'), 'v5');
});

test('re-pushing an existing key refreshes its position without evicting it', () => {
  const cache = createResultCache({ maxEntries: 3 });

  cache.push('k1', 'v1', null, 604800);
  cache.push('k2', 'v2', null, 604800);
  cache.push('k3', 'v3', null, 604800);
  cache.push('k1', 'updated', null, 604800);
  cache.push('k4', 'v4', null, 604800);

  assert.equal(cache.size(), 3);
  assert.equal(cache.get('k1'), 'updated');
  assert.equal(cache.get('k2'), null);
  assert.equal(cache.get('k3'), 'v3');
  assert.equal(cache.get('k4'), 'v4');
});

test('sweeps expired entries without a read while plain node-ttl retains them', async () => {
  const Ttl = require('node-ttl');
  const cache = createResultCache({ sweepMs: 20 });
  const plainStore = new Ttl();
  const originalUptime = os.uptime;
  const initialUptime = os.uptime();

  try {
    os.uptime = () => initialUptime;
    cache.push('expires', 'cached value', null, 1);
    plainStore.push('expires', 'plain value', null, 1);
    os.uptime = () => initialUptime + (8 * 24 * 60 * 60);
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(cache.size(), 0);
    assert.equal(plainStore.size(), 1);
  } finally {
    os.uptime = originalUptime;
    plainStore.del('expires');
  }
});

test('returns null for a key that was never pushed', () => {
  const cache = createResultCache();

  assert.equal(cache.get('missing'), null);
});

test('limitCache applies the cap to a store that already exists', () => {
  const Ttl = require('node-ttl');
  const store = limitCache(new Ttl(), { maxEntries: 2, sweepMs: 0 });

  store.push('a', 1, null, 604800);
  store.push('b', 2, null, 604800);
  store.push('c', 3, null, 604800);

  assert.equal(store.size(), 2);
  assert.equal(store.get('a'), null);
  assert.equal(store.get('c'), 3);
});
