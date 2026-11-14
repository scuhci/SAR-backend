// A flagged scraper must reach every address in ALERT_EMAILS: a failed alert send is
// retried on the next failing check, and one bad recipient does not stop the others.
// Store calls and the mail transport are stubbed; nothing is sent.
const test = require("node:test");
const assert = require("node:assert/strict");

const recipients = ["dev1@example.invalid", "dev2@example.invalid"];

function loadFreshHealthCheck() {
  const healthCheckPath = require.resolve("../utilities/healthCheck");
  delete require.cache[healthCheckPath];

  try {
    delete require.cache[require.resolve("../utilities/loadEnv")];
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") {
      throw error;
    }
  }

  return require("../utilities/healthCheck");
}

async function runScenario(t, { storeDownThrough, totalChecks, smtpFails }) {
  const previousAlertEmails = process.env.ALERT_EMAILS;
  const previousThreshold = process.env.HEALTH_FAILURE_THRESHOLD;
  process.env.ALERT_EMAILS = recipients.join(",");
  delete process.env.HEALTH_FAILURE_THRESHOLD;

  t.after(() => {
    if (previousAlertEmails === undefined) {
      delete process.env.ALERT_EMAILS;
    } else {
      process.env.ALERT_EMAILS = previousAlertEmails;
    }
    if (previousThreshold === undefined) {
      delete process.env.HEALTH_FAILURE_THRESHOLD;
    } else {
      process.env.HEALTH_FAILURE_THRESHOLD = previousThreshold;
    }
  });

  const gplay = require("google-play-scraper");
  const nodemailer = require("nodemailer");
  let storeUp = false;
  let checkNumber = 0;
  let sendAttempts = 0;
  const mails = [];

  const serviceResult = (up, value) => async () => {
    if (!up) {
      throw new Error("getaddrinfo ENOTFOUND play.google.com");
    }
    return value;
  };

  t.mock.method(gplay, "search", (...args) => serviceResult(storeUp, [{ title: "Instagram" }])(...args));
  t.mock.method(gplay, "app", (...args) => serviceResult(storeUp, { appId: "com.instagram.android", title: "Instagram" })(...args));
  t.mock.method(gplay, "reviews", (...args) => serviceResult(storeUp, { data: [{ id: "review-1" }] })(...args));
  t.mock.method(gplay, "list", (...args) => serviceResult(storeUp, [{ appId: "com.instagram.android" }])(...args));
  t.mock.method(gplay, "permissions", (...args) => serviceResult(storeUp, ["INTERNET"])(...args));
  t.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (msg) => {
      sendAttempts++;
      if (smtpFails(msg.to, msg.subject, checkNumber)) {
        throw new Error("getaddrinfo ENOTFOUND smtp.gmail.com");
      }
      const kind = msg.subject.includes("RESOLVED") ? "RESOLVED" : "ALERT";
      mails.push(`${kind}->${msg.to}@check${checkNumber}`);
    },
  }));
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});

  const healthCheck = loadFreshHealthCheck();
  for (let check = 1; check <= totalChecks; check++) {
    checkNumber = check;
    storeUp = check > storeDownThrough;
    await healthCheck.checkAllServices();
  }

  return { mails, sendAttempts };
}

test("A: sends one alert to each recipient and recovery on healthy SMTP", async (t) => {
  const result = await runScenario(t, {
    storeDownThrough: 6,
    totalChecks: 7,
    smtpFails: () => false,
  });

  assert.deepEqual(result.mails, [
    "ALERT->dev1@example.invalid@check3",
    "ALERT->dev2@example.invalid@check3",
    "RESOLVED->dev1@example.invalid@check7",
    "RESOLVED->dev2@example.invalid@check7",
  ]);
  assert.equal(result.sendAttempts, 4);
});

test("B: retries failed alert recipients on the next failing check", async (t) => {
  const result = await runScenario(t, {
    storeDownThrough: 8,
    totalChecks: 9,
    smtpFails: (_recipient, _subject, check) => check <= 3,
  });

  assert.deepEqual(result.mails, [
    "ALERT->dev1@example.invalid@check4",
    "ALERT->dev2@example.invalid@check4",
    "RESOLVED->dev1@example.invalid@check9",
    "RESOLVED->dev2@example.invalid@check9",
  ]);
  assert.equal(result.sendAttempts, 6);
});

test("C: retries only the recipient still owed an alert", async (t) => {
  const result = await runScenario(t, {
    storeDownThrough: 4,
    totalChecks: 5,
    smtpFails: (recipient, subject) => recipient === recipients[0] && !subject.includes("RESOLVED"),
  });

  assert.deepEqual(result.mails, [
    "ALERT->dev2@example.invalid@check3",
    "RESOLVED->dev1@example.invalid@check5",
    "RESOLVED->dev2@example.invalid@check5",
  ]);
  assert.equal(result.sendAttempts, 5);
});

test("D: does not repeat alerts after all recipients are notified", async (t) => {
  const result = await runScenario(t, {
    storeDownThrough: 8,
    totalChecks: 8,
    smtpFails: () => false,
  });

  assert.deepEqual(result.mails, [
    "ALERT->dev1@example.invalid@check3",
    "ALERT->dev2@example.invalid@check3",
  ]);
  assert.equal(result.sendAttempts, 2);
});

test("E: a recovery recipient failure does not stop the next recipient", async (t) => {
  const result = await runScenario(t, {
    storeDownThrough: 3,
    totalChecks: 4,
    smtpFails: (recipient, subject) => recipient === recipients[0] && subject.includes("RESOLVED"),
  });

  assert.deepEqual(result.mails, [
    "ALERT->dev1@example.invalid@check3",
    "ALERT->dev2@example.invalid@check3",
    "RESOLVED->dev2@example.invalid@check4",
  ]);
  assert.equal(result.sendAttempts, 4);
});
