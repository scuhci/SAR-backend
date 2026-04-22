import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // Override with K6_VUS and K6_DURATION while running.
  vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 1,
  duration: __ENV.K6_DURATION || '3m',
};

export default function () {
  // Endpoint and query defaults for gPlay keyword search.
  const baseUrl = (__ENV.BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
  const searchPath = __ENV.SEARCH_PATH || '/api/search';
  const query = __ENV.QUERY || 'instagram';
  const countryCode = __ENV.COUNTRY_CODE || 'US';
  const includePermissions = __ENV.INCLUDE_PERMISSIONS || 'false';

  // Increase timeout for scraper-heavy responses if needed.
  const requestTimeout = __ENV.K6_TIMEOUT || '300s';
  const pauseSeconds = __ENV.SLEEP_SECONDS ? Number(__ENV.SLEEP_SECONDS) : 1;

  // `time` is optional metadata, useful when checking backend logs.
  const url =
    `${baseUrl}${searchPath}` +
    `?query=${encodeURIComponent(query)}` +
    `&countryCode=${encodeURIComponent(countryCode)}` +
    `&includePermissions=${encodeURIComponent(includePermissions)}` +
    `&time=${encodeURIComponent(new Date().toISOString())}`;

  const res = http.get(url, {
    timeout: requestTimeout,
    tags: { service: 'gplay', endpoint: searchPath },
  });

  // Keep checks minimal and readable for quick pass/fail signal.
  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is non-empty': (r) => Boolean(r.body && r.body.length > 0),
  });

  sleep(pauseSeconds);
}
