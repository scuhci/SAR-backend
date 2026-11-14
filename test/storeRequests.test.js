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

test("GSR-02: retry policy covers transient failures but not parse errors or 404", () => {
  assert.equal(isRetryable(withStatus(429)), true);
  assert.equal(isRetryable(withStatus(503)), true);
  assert.equal(isRetryable(withStatus(408)), true);
  assert.equal(isRetryable(new TypeError("Cannot read properties of undefined")), false);
  assert.equal(isRetryable(new SyntaxError("Unexpected token")), false);
  assert.equal(isRetryable(new RangeError("Invalid array length")), false);
  assert.equal(isRetryable(new ReferenceError("missingValue is not defined")), false);
  assert.equal(isRetryable(new Error("Error requesting Google Play:socket hang up")), true);
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
    (error) => {
      assert.equal(error.code, "TIME_BUDGET");
      assert.match(error.message, /Time budget/);
      return true;
    },
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

test("GSR-03: the queue runs with a limit of 0 or NaN and stops after a rejection", async () => {
  assert.deepEqual(await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2), [2, 4, 6]);
  assert.deepEqual(await mapWithConcurrency([1, 2, 3], NaN, async (n) => n * 2), [2, 4, 6]);

  let calls = 0;
  await assert.rejects(
    mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
      calls++;
      if (n === 1) throw new Error("boom");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }),
    /boom/,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(calls <= 3, `started ${calls} items after a rejection`);
});
