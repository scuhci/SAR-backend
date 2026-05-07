import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 1,
  duration: __ENV.K6_DURATION || '3m',
  thresholds: {
    http_req_failed: ['rate<0.10'], // relaxed for Tor
  },
};

export default function () {
  const baseUrl            = (__ENV.BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
  const collection         = __ENV.COLLECTION          || 'TOP_FREE';
  const category           = __ENV.CATEGORY            || '';
  const country            = __ENV.COUNTRY             || 'us';
  const num                = __ENV.NUM                 || '5';
  const includePermissions = __ENV.INCLUDE_PERMISSIONS || 'false';

  const url =
    `${baseUrl}/toplists` +
    `?collection=${encodeURIComponent(collection)}` +
    `&category=${encodeURIComponent(category)}` +
    `&country=${encodeURIComponent(country)}` +
    `&num=${encodeURIComponent(num)}` +
    `&includePermissions=${encodeURIComponent(includePermissions)}` +
    `&time=${encodeURIComponent(new Date().toISOString())}`;

  console.log(`[VU ${__VU}] Fetching toplists | Collection: ${collection} | Routing via Tor`);

  const res = http.get(url, {
    timeout: '600s', // increased for Tor overhead
    tags: { service: 'gplay', endpoint: '/toplists' },
  });

  check(res, {
    'status is 200':     (r) => r.status === 200,
    'body is non-empty': (r) => Boolean(r.body && r.body.length > 0),
  });

  sleep(3); // give Tor breathing room
}