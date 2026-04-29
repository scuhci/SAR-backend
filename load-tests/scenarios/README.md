# SAR Backend Load Testing
## Prerequisites

1. Install k6: 
   - macOS: `brew install k6`
   - Windows: `winget install gnu.k6`
2. Backend: Ensure your Node.js server is running (default: `http://localhost:5001`).

---

## 📂 Test Scenarios

### 1. Standard Keyword Search
File: `search_gplay.js`  
Tests the basic `/api/search` endpoint Rotates through a list of top apps (Instagram, WhatsApp, Facebook, etc.) to test variety.
- Usage: `k6 run load-tests/scenarios/search_gplay.js`

### 3. Multiple IP Stress Test
File: `search_multiple_ip.js`  
Simulates traffic from multiple local IP addresses to prevent port exhaustion.
- Usage: `k6 run load-tests/scenarios/search_multiple_ip.js`
- Requirement: Local IP aliases (`192.168.1.10-12`) must be configured on the host OS.

### 4. App Reviews Test
File: `reviews_gplay.js`  
Stress tests the `/reviews` endpoint fetching paginated review data.
- Usage: `k6 run load-tests/scenarios/reviews_gplay.js`

### 5. Top Lists Scraper
File: `toplists_gplay.js`  
Evaluates performance when fetching ranked lists (Top Free, Top Paid) across categories.
- Usage: `k6 run load-tests/scenarios/toplists_gplay.js`

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
k6 run load-tests/scenarios/search_gplay.js