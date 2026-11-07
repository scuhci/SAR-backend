// Helpers for calling Google Play through google-play-scraper.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// google-play-scraper sets error.status to the HTTP status code. Under load the
// store also answers with a page the scraper cannot parse (a TypeError with no
// status) or drops the connection (no status); both are worth another try. A
// 4xx other than 408/429, e.g. "App not found (404)", will not change on retry.
function isRetryable(error) {
  const status = error && error.status;
  if (typeof status !== "number") return true;
  return status === 408 || status === 429 || status >= 500;
}

// Options for google-play-scraper calls: give up on a hung request after 20 s
// and leave retrying to withRetry, so one policy decides how often and how long
// we try (got would otherwise retry on its own and honour any Retry-After).
const REQUEST_OPTIONS = Object.freeze({ timeout: 20000, retry: 0 });

// Run fn, retrying retryable failures with exponential backoff plus jitter so a
// throttled batch of requests does not retry in lockstep. No attempt is started,
// and no retry is scheduled, past `deadline` (a Date.now() timestamp).
async function withRetry(
  fn,
  { attempts = 3, baseDelayMs = 1000, deadline = Infinity } = {},
) {
  for (let attempt = 1; ; attempt++) {
    if (Date.now() >= deadline) {
      throw new Error("Time budget for store requests used up");
    }
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error;
      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random() / 2);
      if (Date.now() + delay >= deadline) throw error;
      await sleep(delay);
    }
  }
}

// Map fn over items with at most `limit` calls in flight; results keep input order.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

module.exports = { REQUEST_OPTIONS, isRetryable, withRetry, mapWithConcurrency };
