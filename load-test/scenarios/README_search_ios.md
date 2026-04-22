# search_ios.js

This script load tests the iOS keyword search endpoint using k6.

## Target endpoint

- Default URL: `http://localhost:5002/search`
- Method: `GET`
- Query params sent:
  - `query`
  - `countryCode`
  - `time` (timestamp metadata)

## Default behavior

- Virtual users (`vus`): `1`
- Duration: `3m`
- Query: `instagram`
- Country: `US`
- Request timeout: `300s`
- Sleep between iterations: `1s`

## Environment variables

- `K6_VUS` (default: `1`)
- `K6_DURATION` (default: `3m`)
- `BASE_URL` (default: `http://localhost:5002`)
- `SEARCH_PATH` (default: `/search`)
- `QUERY` (default: `instagram`)
- `COUNTRY_CODE` (default: `US`)
- `K6_TIMEOUT` (default: `300s`)
- `SLEEP_SECONDS` (default: `1`)

## Run examples

### Basic run

```bash
k6 run load-test/scenarios/search_ios.js
```

### Run with custom concurrency and duration

```bash
QUERY=instagram K6_VUS=3 K6_DURATION=5m k6 run load-test/scenarios/search_ios.js
```

### Export summary JSON (recommended)

```bash
mkdir -p load-test/results && QUERY=instagram K6_VUS=3 K6_DURATION=5m k6 run --summary-export=load-test/results/search_ios_vus3_5m_summary.json load-test/scenarios/search_ios.js
```

## Validation checks in script

- status is 200
- response body is non-empty

If either check fails, the run still completes but failures are reported in the k6 summary.
