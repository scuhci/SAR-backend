# search_gplay.js

This script load tests the gPlay keyword search endpoint using k6.

## Target endpoint

- Default URL: `http://localhost:5001/api/search`
- Method: `GET`
- Query params sent:
  - `query`
  - `countryCode`
  - `includePermissions`
  - `time` (timestamp metadata)

## Default behavior

- Virtual users (`vus`): `1`
- Duration: `3m`
- Query: `instagram`
- Country: `US`
- includePermissions: `false`
- Request timeout: `300s`
- Sleep between iterations: `1s`

## Environment variables

- `K6_VUS` (default: `1`)
- `K6_DURATION` (default: `3m`)
- `BASE_URL` (default: `http://localhost:5001`)
- `SEARCH_PATH` (default: `/api/search`)
- `QUERY` (default: `instagram`)
- `COUNTRY_CODE` (default: `US`)
- `INCLUDE_PERMISSIONS` (default: `false`)
- `K6_TIMEOUT` (default: `300s`)
- `SLEEP_SECONDS` (default: `1`)

## Run examples

### Basic run

```bash
k6 run load-tests/scenarios/search_gplay.js
```

### Run with custom concurrency and duration

```bash
QUERY=instagram K6_VUS=3 K6_DURATION=5m k6 run load-tests/scenarios/search_gplay.js
```

### Export summary JSON (recommended)

```bash
mkdir -p load-tests/results && QUERY=instagram K6_VUS=3 K6_DURATION=5m k6 run --summary-export=load-tests/results/search_gplay_vus3_5m_summary.json load-tests/scenarios/search_gplay.js
```

## Validation checks in script

- status is 200
- response body is non-empty

If either check fails, the run still completes but failures are reported in the k6 summary.
