import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const queryData = new SharedArray('search queries', function () {
  return ['instagram', 'whatsapp', 'facebook', 'tiktok', 'snapchat', 'telegram'];
});

const localIPs = [
  '192.168.1.10',
  '192.168.1.11',
  '192.168.1.12'
];

export const options = {
  vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 3,
  duration: __ENV.K6_DURATION || '1m',
};

export default function () {
  const baseUrl = (__ENV.BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
  
  const query = queryData[(__VU - 1) % queryData.length];
  const sourceIp = localIPs[(__VU - 1) % localIPs.length];

  const url = `${baseUrl}/api/search?query=${encodeURIComponent(query)}&countryCode=US`;

  console.log(`VU ${__VU} (IP: ${sourceIp}) searching for: ${query}`);

  const params = {
    timeout: '300s',
    localAddress: sourceIp,
    tags: { 
        service: 'gplay', 
        source_ip: sourceIp 
    },
  };

  const res = http.get(url, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is non-empty': (r) => Boolean(r.body && r.body.length > 0),
  });

  sleep(1);
}