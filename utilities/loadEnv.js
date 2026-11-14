// Loads settings (GMAIL_*, ALERT_EMAILS, HEALTH_CHECK_*) for every module that needs them.
// The deploy workflow links the server's env file into the app directory as
// .env.production; local development uses .env. Both are resolved from the backend
// root rather than the cwd. When both exist, .env.production wins for duplicate keys,
// and variables already set in the environment are never overridden.
const path = require("path");
const dotenv = require("dotenv");

const root = path.join(__dirname, "..");
dotenv.config({ path: [path.join(root, ".env.production"), path.join(root, ".env")] });
