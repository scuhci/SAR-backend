import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 1,
  duration: __ENV.K6_DURATION || '3m',
};

export default function () {
  // Endpoint and query defaults for gPlay top lists.
  const baseUrl            = (__ENV.BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
  const collection         = __ENV.COLLECTION          || 'TOP_FREE';  // TOP_FREE | TOP_PAID | GROSSING
  const category           = __ENV.CATEGORY            || '';          // empty = all categories
  const country            = __ENV.COUNTRY             || 'us';        // must be lowercase
  const num                = __ENV.NUM                 || '5';         // keep low — fullDetail:true hits Google per app
  const includePermissions = __ENV.INCLUDE_PERMISSIONS || 'false';

  // Increase timeout for scraper-heavy responses if needed.
  const requestTimeout = __ENV.K6_TIMEOUT    || '300s';
  const pauseSeconds   = __ENV.SLEEP_SECONDS ? Number(__ENV.SLEEP_SECONDS) : 1;

  // `time` is optional metadata, useful when checking backend logs.
  const url =
    `${baseUrl}/toplists` +
    `?collection=${encodeURIComponent(collection)}` +
    `&category=${encodeURIComponent(category)}` +
    `&country=${encodeURIComponent(country)}` +
    `&num=${encodeURIComponent(num)}` +
    `&includePermissions=${encodeURIComponent(includePermissions)}` +
    `&time=${encodeURIComponent(new Date().toISOString())}`;

  const res = http.get(url, {
    timeout: requestTimeout,
    tags: { service: 'gplay', endpoint: '/toplists' },
  });

  // Keep checks minimal and readable for quick pass/fail signal.
  check(res, {
    'status is 200':     (r) => r.status === 200,
    'body is non-empty': (r) => Boolean(r.body && r.body.length > 0),
  });

  sleep(pauseSeconds);
}