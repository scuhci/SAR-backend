# SAR Backend Load Testing

# Tor Proxy Setup for Load Testing
## Google Play Endpoints

This guide sets up Tor-based IP rotation to bypass Google Play's rate limiting during load tests.

## Prerequisites
- macOS with Homebrew installed
- Node.js backend running locally
- k6 installed (`brew install k6`)

---

## Step 1 — Install Tor
```bash
brew install tor
```

## Step 2 — Configure Tor
```bash
nano /opt/homebrew/etc/tor/torrc
```
Add:
SocksPort 9050
ControlPort 9051
HashedControlPassword ""
MaxCircuitDirtiness 10
NewCircuitPeriod 10

Save: `Ctrl+O` → `Enter`, exit: `Ctrl+X`

> **What these do:**
> - `SocksPort 9050` — exposes Tor as a SOCKS5 proxy
> - `ControlPort 9051` — lets your backend request new circuits (new IPs)
> - `NewCircuitPeriod 10` — rotates to a new exit IP every 10 seconds

---

## Step 3 — Start Tor
```bash
tor
```
Wait for: `Bootstrapped 100% (done): Done`
Leave this terminal open — Tor must stay running during all tests.

---

## Step 4 — Verify Tor is Working
Open a new terminal tab:
```bash
curl --socks5 127.0.0.1:9050 https://check.torproject.org/api/ip
```
Expected response:
```json
{"IsTor": true, "IP": "185.220.101.x"}
```

---

## Step 5 — Install npm Dependencies
```bash
cd path/to/SAR-backend
npm install socks-proxy-agent
```

---

## Step 6 — Backend Changes (already on `gplay-load-test` branch)
Pull the branch — changes are already applied. But for reference, these were added to the very top of `controllers/searchController.js`:

```javascript
const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require('https');
const net = require('net');

const torAgent = new SocksProxyAgent('socks5://127.0.0.1:9050');
https.globalAgent = torAgent;

async function rotateTorCircuit() {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(9051, '127.0.0.1', () => {
      client.write('AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n');
    });
    client.on('data', () => { client.destroy(); resolve(); });
    client.on('error', reject);
  });
}
```

And inside `searchController`, before the first scrape:
```javascript
await rotateTorCircuit();
await new Promise(r => setTimeout(r, 2000));
```

Also remove this line if present — it conflicts:
```javascript
const { globalAgent } = require("node:https"); // DELETE THIS
```

---

## Step 7 — Start the Backend
```bash
npm start
```

---

## Step 8 — Run Load Tests

## Results Summary

| VUs | Success Rate | Avg Response | Failure Rate |
|---|---|---|---|
| 1 | 100% | 3m 10s | 0% |
| 3 | 100% | 4m 53s | 0% |
| 5 | 100% | 5m 03s | 0% |
| 10 | 100% | 5m 54s | 0% |

---

## Notes
- Tor must be running **before** starting the backend and k6
- Local dev and load testing only — do not use in production

## 📂 Test Scenarios

### 1. Standard Keyword Search
File: `search.js`  
Tests the basic `/api/search` endpoint Rotates through a list of top apps (Instagram, WhatsApp, Facebook, etc.) to test variety.
- Usage: `k6 run load-tests/scenarios/search.js`

### 4. App Reviews Test
File: `reviews.js`  
Stress tests the `/reviews` endpoint fetching paginated review data.
- Usage: `k6 run load-tests/scenarios/reviews.js`

### 5. Top Lists Scraper
File: `toplists.js`  
Evaluates performance when fetching ranked lists (Top Free, Top Paid) across categories.
- Usage: `k6 run load-tests/scenarios/toplists.js`

---

## ⚙️ Configuration (Environment Variables)

You can override script defaults directly from your terminal:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `BASE_URL` | `http://localhost:5001` | Target API server URL |
| `K6_VUS` | `1` (or `3`) | Number of concurrent virtual users |
| `K6_DURATION` | `3m` (or `1m`) | Length of the test execution |
| `QUERY` | `instagram` | Keyword for search tests |
| `APP_ID` | `com.instagram.android` | Target ID for review tests |
| `K6_TIMEOUT` | `300s` | Max time to wait for a backend response |
| `SLEEP_SECONDS` | `1` | Wait time between user iterations |

---

## 📊 Run Examples

### Basic Baseline Test
```bash
k6 run load-tests/scenarios/search.js