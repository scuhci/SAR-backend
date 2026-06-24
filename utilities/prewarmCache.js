const axios = require('axios');
const redis = require('./cacheClient');

const DEFAULT_SEARCHES = 'medication reminders,self-care,smartphone addiction';
const EXAMPLE_SEARCHES = (process.env.CACHE_PREWARM_QUERIES || DEFAULT_SEARCHES)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const BASE_URL = `http://localhost:${process.env.PORT || 5002}`;

async function prewarmCache() {
  if (process.env.CACHE_PREWARM === 'false') return;
  console.log('[Cache] Starting pre-warm for example searches...');
  await Promise.allSettled(
    EXAMPLE_SEARCHES.map(async (query) => {
      const cacheKey = `ios:c:US_t:${query}`;
      try {
        const exists = await redis.exists(cacheKey);
        if (exists) {
          console.log(`[Cache] Pre-warm skipped (already cached): "${query}"`);
          return;
        }
      } catch (e) {
        console.warn(`[Cache] Redis check failed for "${query}", proceeding with scrape:`, e.message);
      }
      try {
        await axios.get(`${BASE_URL}/search`, {
          params: { query, countryCode: 'US' },
          timeout: 10 * 60 * 1000,
        });
        console.log(`[Cache] Pre-warmed: "${query}"`);
      } catch (err) {
        console.error(`[Cache] Pre-warm failed for "${query}":`, err.message);
      }
    })
  );
  console.log('[Cache] Pre-warm complete.');
}

module.exports = { prewarmCache };
