# iOS Scraper Load Testing

## Prerequisites

1. Install k6: 
   - macOS: `brew install k6`
   - Windows: `winget install gnu.k6`
2. Backend: Ensure the iOS Scraper service is running (default: `http://localhost:5002`).

---

## Test Scenarios

### 1. iOS Keyword Search
File: `search_ios.js`  
Tests the App Store search functionality for specific keywords.
- Endpoint: `/search`
- Usage: `k6 run load-test/scenarios/search_ios.js`

### 2. iOS App Reviews
File: `reviews.js`  
Tests the retrieval of user reviews.
- Endpoint: `/reviews`
- Usage: `k6 run load-test/scenarios/reviews_ios.js`

### 3. iOS Top Lists
File:`toplists.js`  
Evaluates performance when fetching Apple App Store rankings (e.g., Top Paid, Top Free).
- Endpoint: `/toplists`
- Usage: `k6 run load-test/scenarios/toplists_ios.js`


---

## Configuration (Environment Variables)

You can customize the load and target parameters via environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `BASE_URL` | `http://localhost:5002` | Target iOS Scraper API URL |
| `K6_VUS` | `1` | Number of concurrent virtual users |
| `K6_DURATION` | `3m` | Length of the test execution |
| `QUERY` | `instagram` | Search keyword for search tests |
| `APP_ID` | `com.burbn.instagram` | Target iOS bundle ID for reviews |
| `COUNTRY_CODE` | `US` | Store region (e.g., US, GB, IN) |
| `COLLECTION` | `toppaidapplications` | Top list type for toplist tests |
| `K6_TIMEOUT` | `300s` | Max time to wait for the scraper to respond |
| `SLEEP_SECONDS` | `1` | Pause time between user iterations |

---

## 📊 Run Examples

### Default Baseline Run
```bash
k6 run load-test/scenarios/search_ios.js