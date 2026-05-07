import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import execution from 'k6/execution';

const queries = new SharedArray('search queries', function () {
    return ['instagram', 'whatsapp', 'facebook', 'tiktok', 'snapchat', 'telegram', 'youtube', 'reddit'];
});

export const options = {
    vus: __ENV.VUS ? parseInt(__ENV.VUS) : 1,
    duration: __ENV.DURATION || '30s',
    thresholds: {
        http_req_failed: ['rate<0.10'],  // relaxed — Tor is less stable
    },
};

export default function () {
    const queryIndex = (execution.vu.idInTest - 1) % queries.length;
    const query = queries[queryIndex];

    const baseUrl = __ENV.BASE_URL || 'http://localhost:5001';
    const url = `${baseUrl}/api/search?query=${encodeURIComponent(query)}&countryCode=US`;

    const params = {
        timeout: '600s',  // increased for Tor overhead
        headers: {
            'Content-Type': 'application/json',
        },
        tags: {
            vu_id: String(execution.vu.idInTest),
            query: query,
        },
    };

    console.log(`[VU ${execution.vu.idInTest}] Query: ${query} | Routing via Tor`);

    const res = http.get(url, params);

    check(res, {
        'status is 200': (r) => r.status === 200,
        'body not empty': (r) => r.body && r.body.length > 0,
    });

    sleep(3);
}