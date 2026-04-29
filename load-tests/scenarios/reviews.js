import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus:      __ENV.K6_VUS      ? parseInt(__ENV.K6_VUS, 10) : 1,
  duration: __ENV.K6_DURATION || '3m',
};

export default function () {
  const baseUrl        = (__ENV.BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
  const appId          = __ENV.APP_ID       || 'com.instagram.android';
  const countryCode    = __ENV.COUNTRY_CODE || 'US';
  const lang           = __ENV.LANG         || 'en';
  const sort           = __ENV.SORT         || 'newest';
  const count          = __ENV.COUNT        || '10';
  const requestTimeout = __ENV.K6_TIMEOUT   || '300s';
  const pauseSeconds   = __ENV.SLEEP_SECONDS ? Number(__ENV.SLEEP_SECONDS) : 1;

  const url =
    `${baseUrl}/reviews` +
    `?appId=${encodeURIComponent(appId)}` +
    `&countryCode=${encodeURIComponent(countryCode)}` +
    `&lang=${encodeURIComponent(lang)}` +
    `&sort=${encodeURIComponent(sort)}` +
    `&count=${encodeURIComponent(count)}` +
    `&time=${encodeURIComponent(new Date().toISOString())}`;

  const res = http.get(url, {
    timeout: requestTimeout,
    tags: { service: 'gplay', endpoint: '/reviews' },
  });

  check(res, {
    'status is 200':     (r) => r.status === 200,
    'body is non-empty': (r) => Boolean(r.body && r.body.length > 0),
  });

  sleep(pauseSeconds);
}