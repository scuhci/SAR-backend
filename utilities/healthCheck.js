const gplay = require("google-play-scraper");

// Test data - using Instagram as a stable, popular app
const TEST_CONFIG = {
  appId: "com.instagram.android", // Instagram Android
  searchTerm: "instagram",
  country: "us",
  lang: "en",
  collection: gplay.collection.TOP_FREE,
  category: gplay.category.SOCIAL,
};

// Configuration - can be overridden via environment variables
const HEALTH_CHECK_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS) || 5 * 60 * 1000; // 5 minutes
const CHECK_TIMEOUT = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS) || 10000; // 10 seconds
const CONSECUTIVE_FAILURE_THRESHOLD = parseInt(process.env.HEALTH_FAILURE_THRESHOLD) || 3;

// In-memory health status cache
let healthStatus = {
  lastCheck: null,
  overall: "unknown",
  flagged: false,
  consecutiveFailures: 0,
  flaggedAt: null,
  services: {
    search: { status: "unknown", lastError: null, responseTime: null },
    app: { status: "unknown", lastError: null, responseTime: null },
    reviews: { status: "unknown", lastError: null, responseTime: null },
    list: { status: "unknown", lastError: null, responseTime: null },
    permissions: { status: "unknown", lastError: null, responseTime: null },
  },
};

// Previous status for change detection
let previousOverallStatus = null;

// Consecutive failure counter
let consecutiveFailureCount = 0;

// Flag state
let isFlagged = false;
let flaggedAt = null;

// Interval timer reference for graceful shutdown
let healthCheckInterval = null;

/**
 * Placeholder action to execute when health check failures are flagged
 * TODO: Implement actual alerting mechanism (e.g., email, Slack, PagerDuty)
 * 
 * @param {Object} healthStatus - Current health status object
 */
function onHealthFlagged(healthStatus) {
  console.log("============================================");
  console.log("[HEALTH] ACTION REQUIRED - SCRAPER ISSUES DETECTED");
  console.log("============================================");
  console.log(`[HEALTH] Flagged at: ${healthStatus.flaggedAt}`);
  console.log(`[HEALTH] Consecutive failures: ${healthStatus.consecutiveFailures}`);
  console.log(`[HEALTH] Overall status: ${healthStatus.overall}`);
  console.log("[HEALTH] Affected services:");
  
  for (const [serviceName, serviceStatus] of Object.entries(healthStatus.services)) {
    if (serviceStatus.status === "down") {
      console.log(`[HEALTH]   - ${serviceName}: ${serviceStatus.lastError}`);
    }
  }
  
  console.log("============================================");
  console.log("[HEALTH] TODO: Add notification logic here");
  console.log("[HEALTH]   - Send email alert");
  console.log("[HEALTH]   - Send Slack notification");
  console.log("[HEALTH]   - Trigger PagerDuty incident");
  console.log("[HEALTH]   - Update status page");
  console.log("============================================");
}

/**
 * Placeholder action to execute when health is restored after being flagged
 * TODO: Implement actual recovery notification
 * 
 * @param {Object} healthStatus - Current health status object
 */
function onHealthRestored(healthStatus) {
  console.log("============================================");
  console.log("[HEALTH] RESOLVED - SCRAPER HEALTH RESTORED");
  console.log("============================================");
  console.log(`[HEALTH] Restored at: ${healthStatus.lastCheck}`);
  console.log(`[HEALTH] All services operational`);
  console.log("============================================");
  console.log("[HEALTH] TODO: Add recovery notification logic here");
  console.log("============================================");
}

/**
 * Wraps a promise with a timeout
 */
function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * Check search() function
 */
async function checkSearch() {
  const startTime = Date.now();
  try {
    const results = await withTimeout(
      gplay.search({ term: TEST_CONFIG.searchTerm, country: TEST_CONFIG.country, num: 1 }),
      CHECK_TIMEOUT
    );
    const responseTime = Date.now() - startTime;

    // Validate that we actually got results back
    if (!Array.isArray(results) || results.length === 0) {
      return { status: "down", lastError: "Empty or invalid response (expected at least 1 search result)", responseTime };
    }

    return { status: "up", lastError: null, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return { status: "down", lastError: error.message, responseTime };
  }
}

/**
 * Check app() function
 */
async function checkApp() {
  const startTime = Date.now();
  try {
    const result = await withTimeout(
      gplay.app({ appId: TEST_CONFIG.appId, country: TEST_CONFIG.country }),
      CHECK_TIMEOUT
    );
    const responseTime = Date.now() - startTime;

    // Validate that we got a valid app object with expected fields
    if (!result || !result.appId || !result.title) {
      return { status: "down", lastError: "Empty or invalid response (missing appId or title)", responseTime };
    }

    return { status: "up", lastError: null, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return { status: "down", lastError: error.message, responseTime };
  }
}

/**
 * Check reviews() function
 */
async function checkReviews() {
  const startTime = Date.now();
  try {
    const result = await withTimeout(
      gplay.reviews({
        appId: TEST_CONFIG.appId,
        country: TEST_CONFIG.country,
        lang: TEST_CONFIG.lang,
        sort: gplay.sort.NEWEST,
        num: 1,
      }),
      CHECK_TIMEOUT
    );
    const responseTime = Date.now() - startTime;

    // Validate that we got a response with a data array containing at least 1 review
    if (!result || !Array.isArray(result.data) || result.data.length === 0) {
      return { status: "down", lastError: "Empty or invalid response (expected at least 1 review)", responseTime };
    }

    return { status: "up", lastError: null, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return { status: "down", lastError: error.message, responseTime };
  }
}

/**
 * Check list() function
 */
async function checkList() {
  const startTime = Date.now();
  try {
    const results = await withTimeout(
      gplay.list({
        collection: TEST_CONFIG.collection,
        category: TEST_CONFIG.category,
        country: TEST_CONFIG.country,
        lang: TEST_CONFIG.lang,
        num: 1,
        fullDetail: false, // Faster for health check
      }),
      CHECK_TIMEOUT
    );
    const responseTime = Date.now() - startTime;

    // Validate that we got a non-empty list back
    if (!Array.isArray(results) || results.length === 0) {
      return { status: "down", lastError: "Empty or invalid response (expected at least 1 list entry)", responseTime };
    }

    return { status: "up", lastError: null, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return { status: "down", lastError: error.message, responseTime };
  }
}

/**
 * Check permissions() function
 */
async function checkPermissions() {
  const startTime = Date.now();
  try {
    const results = await withTimeout(
      gplay.permissions({
        appId: TEST_CONFIG.appId,
        country: TEST_CONFIG.country,
        lang: TEST_CONFIG.lang,
      }),
      CHECK_TIMEOUT
    );
    const responseTime = Date.now() - startTime;

    // Validate that we got a non-empty permissions array back
    if (!Array.isArray(results) || results.length === 0) {
      return { status: "down", lastError: "Empty or invalid response (expected at least 1 permission entry)", responseTime };
    }

    return { status: "up", lastError: null, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return { status: "down", lastError: error.message, responseTime };
  }
}

/**
 * Determine overall status based on individual service statuses
 */
function determineOverallStatus(services) {
  const statuses = Object.values(services).map((s) => s.status);
  const upCount = statuses.filter((s) => s === "up").length;
  const totalCount = statuses.length;

  if (upCount === totalCount) {
    return "healthy";
  } else if (upCount === 0) {
    return "unhealthy";
  } else {
    return "degraded";
  }
}

/**
 * Log health check results
 */
function logHealthStatus(services, overall) {
  console.log("[HEALTH] Scraper health check completed");

  for (const [serviceName, serviceStatus] of Object.entries(services)) {
    if (serviceStatus.status === "up") {
      console.log(`[HEALTH] ${serviceName}: UP (${serviceStatus.responseTime}ms)`);
    } else {
      console.log(
        `[HEALTH] ${serviceName}: DOWN - Error: ${serviceStatus.lastError}`
      );
    }
  }

  const upCount = Object.values(services).filter((s) => s.status === "up").length;
  const totalCount = Object.keys(services).length;
  console.log(
    `[HEALTH] Overall status: ${overall.toUpperCase()} (${upCount}/${totalCount} services up)`
  );
}

/**
 * Run all health checks and aggregate results
 */
async function checkAllServices() {
  console.log("[HEALTH] Scraper health check started");

  // Run all checks in parallel for efficiency
  const [searchResult, appResult, reviewsResult, listResult, permissionsResult] =
    await Promise.all([
      checkSearch(),
      checkApp(),
      checkReviews(),
      checkList(),
      checkPermissions(),
    ]);

  const services = {
    search: searchResult,
    app: appResult,
    reviews: reviewsResult,
    list: listResult,
    permissions: permissionsResult,
  };

  const overall = determineOverallStatus(services);

  // Track consecutive failures for degraded/unhealthy status
  if (overall === "degraded" || overall === "unhealthy") {
    consecutiveFailureCount++;
    console.log(`[HEALTH] Consecutive failure count: ${consecutiveFailureCount}`);

    // Flag if threshold reached
    if (consecutiveFailureCount >= CONSECUTIVE_FAILURE_THRESHOLD && !isFlagged) {
      isFlagged = true;
      flaggedAt = new Date().toISOString();
      console.log(`[HEALTH] ⚠️  FLAGGED: Scraper health issues detected ${consecutiveFailureCount} consecutive times!`);
      console.log(`[HEALTH] ⚠️  Flagged at: ${flaggedAt}`);
      console.log(`[HEALTH] ⚠️  Action required: External Google Play scraper may be experiencing issues.`);
      
      // Execute placeholder action for flagged state
      onHealthFlagged({
        lastCheck: new Date().toISOString(),
        overall,
        flagged: true,
        consecutiveFailures: consecutiveFailureCount,
        flaggedAt: flaggedAt,
        services,
      });
    }
  } else {
    // Reset counter when healthy
    if (consecutiveFailureCount > 0) {
      console.log(`[HEALTH] Consecutive failure count reset (was ${consecutiveFailureCount})`);
    }
    consecutiveFailureCount = 0;

    // Clear flag when healthy
    if (isFlagged) {
      console.log(`[HEALTH] ✓ Flag cleared: Scraper health restored to healthy state.`);
      
      // Execute placeholder action for restored state
      onHealthRestored({
        lastCheck: new Date().toISOString(),
        overall,
        flagged: false,
        consecutiveFailures: 0,
        flaggedAt: null,
        services,
      });
      
      isFlagged = false;
      flaggedAt = null;
    }
  }

  // Update cached status
  healthStatus = {
    lastCheck: new Date().toISOString(),
    overall,
    flagged: isFlagged,
    consecutiveFailures: consecutiveFailureCount,
    flaggedAt: flaggedAt,
    services,
  };

  // Log results
  logHealthStatus(services, overall);

  // Log status change if detected
  if (previousOverallStatus !== null && previousOverallStatus !== overall) {
    console.log(
      `[HEALTH] Status changed: ${previousOverallStatus.toUpperCase()} -> ${overall.toUpperCase()}`
    );
  }
  previousOverallStatus = overall;

  return healthStatus;
}

/**
 * Start periodic health check
 */
function startPeriodicHealthCheck() {
  const intervalMinutes = Math.round(HEALTH_CHECK_INTERVAL / 60000);
  console.log(`[HEALTH] Starting periodic health check (interval: ${intervalMinutes} minutes)`);

  // Run initial check immediately
  checkAllServices().catch((error) => {
    console.error("[HEALTH] Initial health check failed:", error.message);
  });

  // Schedule periodic checks and store reference for graceful shutdown
  healthCheckInterval = setInterval(() => {
    checkAllServices().catch((error) => {
      console.error("[HEALTH] Periodic health check failed:", error.message);
    });
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * Stop periodic health check (for graceful shutdown)
 */
function stopPeriodicHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    console.log("[HEALTH] Periodic health check stopped");
    return true;
  }
  return false;
}

/**
 * Get current health status (from cache)
 */
function getHealthStatus() {
  return healthStatus;
}

/**
 * Check if health is currently flagged
 */
function isFlaggedStatus() {
  return {
    flagged: isFlagged,
    consecutiveFailures: consecutiveFailureCount,
    flaggedAt: flaggedAt,
  };
}

/**
 * Manually reset the flag (e.g., after investigating the issue)
 */
function resetFlag() {
  if (isFlagged) {
    console.log("[HEALTH] Flag manually reset by operator");
    isFlagged = false;
    flaggedAt = null;
    consecutiveFailureCount = 0;
    return { success: true, message: "Flag has been reset" };
  }
  return { success: false, message: "No flag to reset" };
}

module.exports = {
  checkAllServices,
  startPeriodicHealthCheck,
  stopPeriodicHealthCheck,
  getHealthStatus,
  isFlaggedStatus,
  resetFlag,
  // Export individual checks for testing
  checkSearch,
  checkApp,
  checkReviews,
  checkList,
  checkPermissions,
};
