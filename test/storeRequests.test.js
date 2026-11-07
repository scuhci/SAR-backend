// Retry policy and request queue in utilities/storeRequests.js.
const test = require("node:test");
const assert = require("node:assert/strict");

const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) =>
  realSetTimeout(fn, ms >= 100 ? 1 : ms, ...args);

const {
  isRetryable,
  withRetry,
  mapWithConcurrency,
} = require("../utilities/storeRequests");

const withStatus = (status) => Object.assign(new Error(`status ${status}`), { status });

test("GSR-02: retry policy covers throttling, server errors and parse failures, not 404", () => {
  assert.equal(isRetryable(withStatus(429)), true);
  assert.equal(isRetryable(withStatus(503)), true);
  assert.equal(isRetryable(withStatus(408)), true);
  assert.equal(isRetryable(new TypeError("Cannot read properties of undefined")), true);
  assert.equal(isRetryable("boom"), true);
  assert.equal(isRetryable(withStatus(404)), false);
  assert.equal(isRetryable(withStatus(400)), false);
});

test("GSR-02: withRetry gives up after three attempts", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw withStatus(429);
    }),
    /status 429/,
  );
  assert.equal(calls, 3);
});

test("GSR-03: no attempt is started after the deadline", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => calls++, { deadline: Date.now() - 1 }),
    /Time budget/,
  );
  assert.equal(calls, 0);
});

test("GSR-03: no retry is scheduled when the backoff would cross the deadline", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw withStatus(503);
      },
      { deadline: Date.now() + 50, baseDelayMs: 1000 },
    ),
    /status 503/,
  );
  assert.equal(calls, 1);
});

test("GSR-03: mapWithConcurrency keeps order and the in-flight limit", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const out = await mapWithConcurrency([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => realSetTimeout(resolve, n));
    inFlight--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0, 60]);
  assert.equal(maxInFlight, 3);
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
});
