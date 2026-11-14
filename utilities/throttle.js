// Apple rate-limits bursts of lookups. createThrottle(concurrency, spacingMs)
// returns mapThrottled(items, fn), which runs fn over every item with at most
// `concurrency` calls in flight and at least `spacingMs` between the start of
// any two calls, and resolves to the results in input order. Calls made
// through the same throttle share the spacing.
function createThrottle(concurrency, spacingMs) {
  let nextStartAt = 0;

  return async function mapThrottled(items, fn) {
    const results = new Array(items.length);
    let next = 0;

    const worker = async () => {
      while (next < items.length) {
        const index = next++;
        const now = Date.now();
        const wait = Math.max(0, nextStartAt - now);
        nextStartAt = Math.max(now, nextStartAt) + spacingMs;

        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }

        results[index] = await fn(items[index]);
      }
    };

    const workers = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workers }, worker));
    return results;
  };
}

module.exports = { createThrottle };
