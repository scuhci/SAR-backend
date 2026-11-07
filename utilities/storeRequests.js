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

// Run fn, retrying retryable failures with exponential backoff plus jitter so a
// throttled batch of requests does not retry in lockstep.
async function withRetry(fn, { attempts = 3, baseDelayMs = 1000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error;
      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random() / 2);
      await sleep(delay);
    }
  }
}

module.exports = { isRetryable, withRetry };
