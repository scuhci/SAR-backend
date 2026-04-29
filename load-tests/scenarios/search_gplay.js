import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const queryData = new SharedArray('search queries', function () {
  return ['instagram', 'whatsapp', 'facebook', 'tiktok', 'snapchat', 'telegram'];
});

export const options = {
  vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 3, 
  duration: __ENV.K6_DURATION || '1m',
};

export default function () {
  const baseUrl = (__ENV.BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
  const searchPath = __ENV.SEARCH_PATH || '/api/search';
  
  const query = queryData[(__VU - 1) % queryData.length];
  
  const countryCode = __ENV.COUNTRY_CODE || 'US';
  const includePermissions = __ENV.INCLUDE_PERMISSIONS || 'false';
  const requestTimeout = __ENV.K6_TIMEOUT || '300s';
  const pauseSeconds = __ENV.SLEEP_SECONDS ? Number(__ENV.SLEEP_SECONDS) : 1;

  const url = `${baseUrl}${searchPath}` +
    `?query=${encodeURIComponent(query)}` +
    `&countryCode=${encodeURIComponent(countryCode)}` +
    `&includePermissions=${encodeURIComponent(includePermissions)}` +
    `&time=${encodeURIComponent(new Date().toISOString())}`;

  console.log(`VU ${__VU} is searching for: ${query}`);

  const res = http.get(url, {
    timeout: requestTimeout,
    tags: { service: 'gplay', query: query }, 
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is non-empty': (r) => Boolean(r.body && r.body.length > 0),
  });

  sleep(pauseSeconds);
}