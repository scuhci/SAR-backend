// Health status before the first periodic check has run. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

test('the cached scraper health reads "unknown" until the first check completes', () => {
  // A freshly loaded module has run no check; /health/scraper maps anything
  // but "unhealthy" to 200.
  const { getHealthStatus } = require('../utilities/healthCheck');
  const status = getHealthStatus();
  assert.equal(status.overall, 'unknown');
  assert.equal(status.lastCheck, null);
  assert.equal(status.flagged, false);
});
