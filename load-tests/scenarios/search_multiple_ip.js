import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import execution from 'k6/execution';

const queries = new SharedArray('search queries', function () {
    return ['instagram', 'whatsapp', 'facebook', 'tiktok', 'snapchat', 'telegram', 'youtube', 'reddit'];
});

function getRandomIP() {
    const min = 10;
    const max = 50;
    const lastOctet = Math.floor(Math.random() * (max - min + 1)) + min;
    return `192.168.1.${lastOctet}`;
}

export const options = {
    vus: __ENV.VUS ? parseInt(__ENV.VUS) : 1,
    duration: __ENV.DURATION || '30s',
    thresholds: {
        http_req_failed: ['rate<0.01'],
    },
};

export default function () {
    const queryIndex = (execution.vu.idInTest - 1) % queries.length;
    const query = queries[queryIndex];

    const sourceIp = getRandomIP();
    const baseUrl = __ENV.BASE_URL || 'http://localhost:5001';
    const url = `${baseUrl}/api/search?query=${encodeURIComponent(query)}&countryCode=US`;

    const params = {
        timeout: '120s',
        headers: {
            'X-Forwarded-For': sourceIp,
            'X-Real-IP': sourceIp,
        },
        tags: {
            vu_id: String(execution.vu.idInTest),
            source_ip: sourceIp,
        },
    };

    console.log(`[VU ${execution.vu.idInTest}] Simulated IP: ${sourceIp} | Query: ${query}`);

    const res = http.get(url, params);

    check(res, {
        'status is 200': (r) => r.status === 200,
    });

    sleep(1);
}