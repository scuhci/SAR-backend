import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const queryData = new SharedArray('ios search queries', function () {
  return ['instagram', 'facebook', 'whatsapp', 'tiktok', 'snapchat', 'telegram'];
});

export const options = {
  vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 1,
  duration: __ENV.K6_DURATION || '3m',
};

export default function () {
  const baseUrl = (__ENV.BASE_URL || 'http://localhost:5002').replace(/\/$/, '');
  const searchPath = __ENV.SEARCH_PATH || '/search';
  
  const query = queryData[(__VU - 1) % queryData.length];
  
  const countryCode = __ENV.COUNTRY_CODE || 'US';

  const requestTimeout = __ENV.K6_TIMEOUT || '300s';
  const pauseSeconds = __ENV.SLEEP_SECONDS ? Number(__ENV.SLEEP_SECONDS) : 1;

  const url =
    `${baseUrl}${searchPath}` +
    `?query=${encodeURIComponent(query)}` +
    `&countryCode=${encodeURIComponent(countryCode)}` +
    `&time=${encodeURIComponent(new Date().toISOString())}`;

  // Log what each VU is doing for easier debugging
  console.log(`VU ${__VU} is searching iOS for: ${query}`);

  const res = http.get(url, {
    timeout: requestTimeout,
    tags: { 
        service: 'ios', 
        endpoint: searchPath,
        query: query // Tagging the specific query for better metrics breakdown
    },
  });

  // Keep checks minimal and readable for quick pass/fail signal.
  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is non-empty': (r) => Boolean(r.body && r.body.length > 0),
  });

  sleep(pauseSeconds);
}