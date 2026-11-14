'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createThrottle } = require('../utilities/throttle');

function enableMockTimers(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => t.mock.timers.reset());
}

async function advanceTime(t, durationMs, stepMs = 250) {
  const steps = Math.ceil(durationMs / stepMs);
  for (let i = 0; i < steps; i += 1) {
    t.mock.timers.tick(stepMs);
    await Promise.resolve();
    await Promise.resolve();
  }
}

test('uses the requested concurrency and preserves result order', async (t) => {
  enableMockTimers(t);
  const throttle = createThrottle(4, 250);
  const items = Array.from({ length: 12 }, (_, index) => index);
  let inFlight = 0;
  let peakInFlight = 0;

  const resultsPromise = throttle(items, (item) => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    return new Promise((resolve) => {
      setTimeout(() => {
        inFlight -= 1;
        resolve(item * 2);
      }, 5000);
    });
  });

  await advanceTime(t, 20000);
  const results = await resultsPromise;

  assert.equal(peakInFlight, 4);
  assert.deepEqual(results, items.map((item) => item * 2));
});

test('spaces every function start by at least the configured interval', async (t) => {
  enableMockTimers(t);
  const throttle = createThrottle(4, 250);
  const startTimes = [];
  const resultsPromise = throttle(Array.from({ length: 8 }, (_, index) => index), (item) => {
    startTimes.push(Date.now());
    return new Promise((resolve) => setTimeout(() => resolve(item), 1000));
  });

  await advanceTime(t, 5000);
  await resultsPromise;

  assert.equal(startTimes.length, 8);
  for (let i = 1; i < startTimes.length; i += 1) {
    assert.ok(startTimes[i] - startTimes[i - 1] >= 250);
  }
});

test('shares spacing between consecutive calls on one throttle', async (t) => {
  enableMockTimers(t);
  const throttle = createThrottle(2, 250);
  const startTimes = [];
  const fn = (item) => {
    startTimes.push(Date.now());
    return Promise.resolve(item);
  };

  const firstResultsPromise = throttle(['first'], fn);
  await Promise.resolve();
  await firstResultsPromise;

  const secondResultsPromise = throttle(['second'], fn);
  await advanceTime(t, 250);
  await secondResultsPromise;

  assert.equal(startTimes.length, 2);
  assert.ok(startTimes[1] - startTimes[0] >= 250);
});

test('completes when there are fewer items than the concurrency limit', async (t) => {
  enableMockTimers(t);
  const throttle = createThrottle(5, 0);
  const resultsPromise = throttle([3, 1], async (item) => item + 1);

  await Promise.resolve();
  assert.deepEqual(await resultsPromise, [4, 2]);
});
