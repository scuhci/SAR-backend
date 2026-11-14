// GET /health and /health/scraper. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, delay } = require('./support/server');

const liveChecks = (server) => server.count(/\[HEALTH\] Scraper health check started/g);
const scraperCalls = (server) => server.count(/\[STUB\] scraper call:/g);

test('/health/scraper serves the last periodic result without running checks or counting failures', async () => {
  const server = await startServer({ APP_STORE_STUB: 'down' });
  try {
    const polls = [];
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${server.base}/health/scraper`);
      polls.push({ status: res.status, body: await res.json() });
    }
    await delay(300); // let any stray log lines arrive

    for (const poll of polls) {
      assert.equal(poll.status, 503);
      assert.equal(poll.body.overall, 'unhealthy');
      assert.equal(poll.body.consecutiveFailures, 1, 'only the startup check may count a failure');
      assert.equal(poll.body.flagged, false);
    }
    assert.equal(polls[0].body.lastCheck, polls[2].body.lastCheck);
    assert.equal(liveChecks(server), 1, 'polls must not run checkAllServices');
    assert.equal(scraperCalls(server), 5, 'polls must not call the App Store');
    assert.ok(!server.output().includes('FLAGGED'), 'polls must not trip the alert flag');
  } finally {
    await server.stop();
  }
});

test('/health/scraper reports a healthy cached result and /health answers', async () => {
  const server = await startServer();
  try {
    const res = await fetch(`${server.base}/health/scraper`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.overall, 'healthy');
    assert.deepEqual(Object.keys(body.services).sort(), ['app', 'list', 'reviews', 'search', 'similar']);
    assert.equal(liveChecks(server), 1);

    const liveness = await fetch(`${server.base}/health`);
    assert.equal(liveness.status, 200);
    assert.equal((await liveness.json()).status, 'ok');
  } finally {
    await server.stop();
  }
});
