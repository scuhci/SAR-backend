// The deploy workflow links the server's env file into the app directory as
// .env.production and runs `pm2 start index.js` there. Check that the modules
// which read settings (search emails, health alerts) actually see that file.
// Runs against a throwaway copy of the backend so no real env file is touched.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
let copy;

test.before(() => {
    copy = fs.mkdtempSync(path.join(os.tmpdir(), "smar-env-"));
    for (const entry of ["controllers", "routes", "utilities", "index.js", "package.json"]) {
        fs.cpSync(path.join(root, entry), path.join(copy, entry), { recursive: true });
    }
    fs.symlinkSync(fs.realpathSync(path.join(root, "node_modules")), path.join(copy, "node_modules"));
    fs.writeFileSync(path.join(copy, ".env.production"), "SMAR_ENV_PROBE=from-env-production\n");
});

test.after(() => {
    fs.rmSync(copy, { recursive: true, force: true });
});

function probe(modulePath, cwd) {
    const script = `require(${JSON.stringify(path.join(copy, modulePath))}); process.stdout.write("PROBE=" + process.env.SMAR_ENV_PROBE);`;
    const out = execFileSync(process.execPath, ["-e", script], { cwd, env: { PATH: process.env.PATH }, timeout: 30000 }).toString();
    return out.slice(out.lastIndexOf("PROBE=") + "PROBE=".length);
}

test("health check and search controller load .env.production from the app directory", () => {
    assert.strictEqual(probe("utilities/healthCheck.js", copy), "from-env-production");
    // searchRoutes loads the search controller (requiring the controller first hits an
    // existing require cycle between the two).
    assert.strictEqual(probe("routes/searchRoutes.js", copy), "from-env-production");
});

test("the env file is found even when the process starts in another directory", () => {
    assert.strictEqual(probe("utilities/healthCheck.js", os.tmpdir()), "from-env-production");
});
