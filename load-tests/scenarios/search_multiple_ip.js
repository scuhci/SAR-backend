import http from 'k6/http';
import { check, sleep } from 'k6';

// Add as many proxies as you have available
const PROXIES = [
  'http://proxy1:port',
  'http://proxy2:port',
  'http://proxy3:port',
  // ...
];

export const options = {
  vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 1,
  duration: __ENV.K6_DURATION || '3m',
};

export default function () {
  const baseUrl = (__ENV.BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
  const searchPath = __ENV.SEARCH_PATH || '/api/search';
  const query = __ENV.QUERY || 'instagram';
  const countryCode = __ENV.COUNTRY_CODE || 'US';
  const includePermissions = __ENV.INCLUDE_PERMISSIONS || 'false';
  const requestTimeout = __ENV.K6_TIMEOUT || '300s';
  const pauseSeconds = __ENV.SLEEP_SECONDS ? Number(__ENV.SLEEP_SECONDS) : 1;

  // Each VU picks a proxy based on its ID so they're spread across proxies
  const proxy = PROXIES[(__VU - 1) % PROXIES.length];

  const url =
    `${baseUrl}${searchPath}` +
    `?query=${encodeURIComponent(query)}` +
    `&countryCode=${encodeURIComponent(countryCode)}` +
    `&includePermissions=${encodeURIComponent(includePermissions)}` +
    `&time=${encodeURIComponent(new Date().toISOString())}`;

  const res = http.get(url, {
    timeout: requestTimeout,
    tags: { service: 'gplay', endpoint: searchPath },
    // Route this VU's traffic through its assigned proxy
    headers: {},
    // k6 proxy option:
    proxy: proxy,
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is non-empty': (r) => Boolean(r.body && r.body.length > 0),
    'no rate limit': (r) => r.status !== 429,
  });

  sleep(pauseSeconds);
}