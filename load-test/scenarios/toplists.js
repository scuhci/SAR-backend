import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 1,
  duration: __ENV.K6_DURATION || '3m',
};

export default function () {
  const baseUrl = (__ENV.BASE_URL || 'http://localhost:5002').replace(/\/$/, '');
  const collection  = __ENV.COLLECTION   || 'toppaidapplications';
  const category    = __ENV.CATEGORY     || '0';
  const categoryName = __ENV.CATEGORY_NAME || 'Overall';
  const country     = __ENV.COUNTRY_CODE  || 'US';
  const num         = __ENV.NUM           || '100';
  const requestTimeout = __ENV.K6_TIMEOUT || '300s';
  const pauseSeconds = __ENV.SLEEP_SECONDS ? Number(__ENV.SLEEP_SECONDS) : 1;

  const url =
    `${baseUrl}/toplists` +
    `?collection=${encodeURIComponent(collection)}` +
    `&category=${encodeURIComponent(category)}` +
    `&categoryName=${encodeURIComponent(categoryName)}` +
    `&country=${encodeURIComponent(country)}` +
    `&num=${encodeURIComponent(num)}`;

  const res = http.get(url, {
    timeout: requestTimeout,
    tags: { service: 'ios', endpoint: 'toplists' },
  });

  check(res, {
    'status is 200':        (r) => r.status === 200,
    'body is non-empty':    (r) => Boolean(r.body && r.body.length > 0),
    'no rate limit':        (r) => r.status !== 429,
    'has totalCount field': (r) => {
      try {
        return JSON.parse(r.body).totalCount > 0;
      } catch { return false; }
    },
  });

  sleep(pauseSeconds);
}