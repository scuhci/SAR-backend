// Checks that intermittent failures do not flap health notifications.
// Covers sustained recovery, the configurable recovery threshold, and partial outages.
// All store calls and email delivery are stubbed so no external requests are made.
const test = require("node:test");
const assert = require("node:assert/strict");

const recipients = ["dev1@example.invalid", "dev2@example.invalid"];

function loadFreshHealthCheck() {
  const healthCheckPath = require.resolve("../utilities/healthCheck");
  delete require.cache[healthCheckPath];
  try {
    delete require.cache[require.resolve("../utilities/loadEnv")];
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }
  return require("../utilities/healthCheck");
}

async function runScenario(t, { totalChecks, isFailing, recoveryThreshold }) {
  const previous = {
    alertEmails: process.env.ALERT_EMAILS,
    failureThreshold: process.env.HEALTH_FAILURE_THRESHOLD,
    recoveryThreshold: process.env.HEALTH_RECOVERY_THRESHOLD,
  };
  process.env.ALERT_EMAILS = recipients.join(",");
  delete process.env.HEALTH_FAILURE_THRESHOLD;
  if (recoveryThreshold === undefined) delete process.env.HEALTH_RECOVERY_THRESHOLD;
  else process.env.HEALTH_RECOVERY_THRESHOLD = String(recoveryThreshold);
  t.after(() => {
    for (const [key, value] of [
      ["ALERT_EMAILS", previous.alertEmails],
      ["HEALTH_FAILURE_THRESHOLD", previous.failureThreshold],
      ["HEALTH_RECOVERY_THRESHOLD", previous.recoveryThreshold],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const gplay = require("google-play-scraper");
  const nodemailer = require("nodemailer");
  let checkNumber = 0;
  const mails = [];
  const result = (service, value) => async () => {
    if (isFailing(checkNumber) && (!isFailing.reviewsOnly || service === "reviews")) {
      throw new Error("getaddrinfo ENOTFOUND play.google.com");
    }
    return value;
  };
  t.mock.method(gplay, "search", () => result("search", [{ title: "Instagram" }])());
  t.mock.method(gplay, "app", () => result("app", { appId: "com.instagram.android", title: "Instagram" })());
  t.mock.method(gplay, "reviews", () => result("reviews", { data: [{ id: "review-1" }] })());
  t.mock.method(gplay, "list", () => result("list", [{ appId: "com.instagram.android" }])());
  t.mock.method(gplay, "permissions", () => result("permissions", ["INTERNET"])());
  t.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (message) => mails.push({
      kind: message.subject.includes("RESOLVED") ? "RESOLVED" : "ALERT",
      to: message.to,
      check: checkNumber,
    }),
  }));
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});

  const healthCheck = loadFreshHealthCheck();
  const states = [];
  for (checkNumber = 1; checkNumber <= totalChecks; checkNumber++) {
    await healthCheck.checkAllServices();
    states.push(healthCheck.isFlaggedStatus().flagged);
  }
  return { mails, states, healthCheck };
}

function countKind(mails, kind) {
  return mails.filter((mail) => mail.kind === kind).length;
}

test("an intermittent store does not produce a mail pair every 20 minutes", async (t) => {
  const result = await runScenario(t, {
    totalChecks: 288,
    isFailing: (check) => check % 4 !== 0,
  });
  assert.equal(countKind(result.mails, "ALERT"), 2);
  assert.equal(countKind(result.mails, "RESOLVED"), 0);
  assert.equal(result.healthCheck.isFlaggedStatus().flagged, true);
});

test("a sustained outage still alerts once and recovers once", async (t) => {
  const result = await runScenario(t, {
    totalChecks: 288,
    isFailing: (check) => check >= 100 && check <= 123,
  });
  const resolved = result.mails.filter((mail) => mail.kind === "RESOLVED");
  assert.equal(countKind(result.mails, "ALERT"), 2);
  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved.map((mail) => mail.check), [126, 126]);
  assert.equal(result.healthCheck.isFlaggedStatus().flagged, false);
});

test("one healthy check does not clear the flag, three in a row do", async (t) => {
  const failing = new Set([1, 2, 3, 6]);
  const result = await runScenario(t, {
    totalChecks: 9,
    isFailing: (check) => failing.has(check),
  });
  assert.deepEqual(result.states, [false, false, true, true, true, true, true, true, false]);
  assert.deepEqual(result.mails.filter((mail) => mail.kind === "RESOLVED").map((mail) => mail.check), [9, 9]);
  assert.equal(countKind(result.mails, "ALERT"), 2);
});

test("HEALTH_RECOVERY_THRESHOLD overrides the number of healthy checks needed", async (t) => {
  const result = await runScenario(t, {
    totalChecks: 4,
    isFailing: (check) => check <= 3,
    recoveryThreshold: 1,
  });
  assert.equal(result.healthCheck.isFlaggedStatus().flagged, false);
  assert.deepEqual(result.mails.filter((mail) => mail.kind === "RESOLVED").map((mail) => mail.check), [4, 4]);
});

test("a store that only one of five services fails on counts as failing", async (t) => {
  const isFailing = (check) => check % 4 !== 0;
  isFailing.reviewsOnly = true;
  const result = await runScenario(t, { totalChecks: 40, isFailing });
  assert.equal(countKind(result.mails, "ALERT"), 2);
  assert.equal(countKind(result.mails, "RESOLVED"), 0);
  assert.equal(result.healthCheck.isFlaggedStatus().flagged, true);
});
