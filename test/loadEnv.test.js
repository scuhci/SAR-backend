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
    fs.writeFileSync(path.join(copy, ".env"), "SMAR_ENV_PROBE=from-env\nSMAR_ENV_ONLY=only-in-env\nSMAR_ENV_SHELL=from-env-file\n");
    fs.writeFileSync(path.join(copy, ".env.production"), "SMAR_ENV_PROBE=from-env-production\nSMAR_ENV_SHELL=from-env-production-file\n");
});

test.after(() => {
    fs.rmSync(copy, { recursive: true, force: true });
});

function probe(modulePath, cwd, variableNames = ["SMAR_ENV_PROBE"], extraEnv = {}) {
    const script = `require(${JSON.stringify(path.join(copy, modulePath))}); process.stdout.write("PROBE=" + JSON.stringify(Object.fromEntries(${JSON.stringify(variableNames)}.map((name) => [name, process.env[name]]))));`;
    const out = execFileSync(process.execPath, ["-e", script], {
        cwd,
        env: { PATH: process.env.PATH, ...extraEnv },
        timeout: 30000,
    }).toString();
    return JSON.parse(out.slice(out.lastIndexOf("PROBE=") + "PROBE=".length));
}

test("health check and search controller load .env.production from the app directory", () => {
    assert.strictEqual(probe("utilities/healthCheck.js", copy).SMAR_ENV_PROBE, "from-env-production");
    // searchRoutes loads the search controller (requiring the controller first hits an
    // existing require cycle between the two).
    assert.strictEqual(probe("routes/searchRoutes.js", copy).SMAR_ENV_PROBE, "from-env-production");
});

test("the env file is found even when the process starts in another directory", () => {
    assert.strictEqual(probe("utilities/healthCheck.js", os.tmpdir()).SMAR_ENV_PROBE, "from-env-production");
});

test(".env.production takes precedence without overriding the shell environment", () => {
    const values = probe("utilities/loadEnv.js", copy, ["SMAR_ENV_PROBE", "SMAR_ENV_ONLY", "SMAR_ENV_SHELL"], {
        SMAR_ENV_SHELL: "from-shell",
    });
    assert.deepStrictEqual(values, {
        SMAR_ENV_PROBE: "from-env-production",
        SMAR_ENV_ONLY: "only-in-env",
        SMAR_ENV_SHELL: "from-shell",
    });
});
