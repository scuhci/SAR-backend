// Runs the real deploy script from .github/workflows/aws.yml in a temp directory, with
// host paths rewritten and sudo/pm2/npm/curl replaced by stubs, to check two things:
// old rollback backups are pruned (each is a full copy of the app, node_modules
// included), and a backup that fails part-way stops the deploy before the running
// app is stopped or wiped.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const workflowPath = path.join(__dirname, "..", ".github", "workflows", "aws.yml");
const lines = fs.readFileSync(workflowPath, "utf8").split(/\r?\n/);
const step = lines.findIndex((line) => line.trim() === "- name: Deploy and build on EC2");
assert.notEqual(step, -1, "Deploy and build on EC2 step not found");
const marker = lines.findIndex((line, i) => i > step && line.trim() === "script: |");
assert.notEqual(marker, -1, "script block not found");
const body = [];
for (let i = marker + 1; i < lines.length; i++) {
  if (lines[i].trim() && !/^ {12}/.test(lines[i])) break;
  body.push(lines[i].replace(/^ {12}/, ""));
}
let script = body.join("\n");
assert.match(script, /run_smoke_test/);
assert.match(script, /BACKUP_DIR=/);

let sandbox;
test.before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-test-"));
  for (const name of ["home", "bin", "tmp", "config"]) fs.mkdirSync(path.join(sandbox, name), { recursive: true });
  fs.writeFileSync(path.join(sandbox, "config", ".env.production"), "");
  script = script.replaceAll("/home/ubuntu/smar/SAR-backend", path.join(sandbox, "app"))
    .replaceAll("/var/backups", path.join(sandbox, "backups"))
    .replaceAll("/var/www/config/smar", path.join(sandbox, "config"))
    .replaceAll("/tmp/deploy.tar.gz", path.join(sandbox, "tmp", "deploy.tar.gz"));
  // Nothing in the script may still point at a real host path.
  assert.doesNotMatch(script, /\/var\/backups|\/home\/ubuntu|\/var\/www|(^|[^\w/])\/tmp\/deploy/);
  fs.writeFileSync(path.join(sandbox, "script.sh"), script);
  const bin = path.join(sandbox, "bin");
  const stubs = {
    sudo: "#!/bin/bash\nif [ -f \"" + sandbox + "/fail-backup\" ] && [ \"$1\" = cp ] && [ \"$2\" = -r ] && [ \"$3\" = \"" + sandbox + "/app\" ]; then\n  mkdir -p \"$4\"\n  cp \"" + sandbox + "/app/package.json\" \"$4/\"\n  echo \"cp: No space left on device\" >&2\n  exit 1\nfi\nexec \"$@\"\n",
    chown: "#!/bin/bash\nexit 0\n",
    node: "#!/bin/bash\necho v22.0.0\n",
    npm: "#!/bin/bash\nif [ \"$1\" = ci ]; then mkdir -p node_modules; echo x > node_modules/marker; exit 0; fi\nif [ \"$1\" = --version ]; then echo 10.0.0; exit 0; fi\nexit 0\n",
    pm2: "#!/bin/bash\necho \"pm2 $*\"\nexit 0\n",
    curl: "#!/bin/bash\n[ -f \"" + sandbox + "/curl-fails\" ] && exit 22\nexit 0\n",
    sleep: "#!/bin/bash\nexit 0\n",
    date: "#!/bin/bash\ncounter=\"" + sandbox + "/date-counter\"\nn=0; [ -f \"$counter\" ] && n=$(cat \"$counter\")\nn=$((n + 1)); echo \"$n\" > \"$counter\"\nprintf '20260101-0000%02d\\n' \"$n\"\n",
  };
  for (const [name, contents] of Object.entries(stubs)) {
    const target = path.join(bin, name);
    fs.writeFileSync(target, contents, { mode: 0o755 });
    fs.chmodSync(target, 0o755);
  }
});
test.after(() => { if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true }); });
test.beforeEach(() => {
  for (const name of ["app", "backups", "curl-fails", "fail-backup"]) {
    fs.rmSync(path.join(sandbox, name), { recursive: true, force: true });
  }
});

function deploy(n) {
  const stage = path.join(sandbox, "stage-" + n);
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, "index.js"), "console.log(" + n + ");\n");
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ name: "deploy-test", version: "1.0.0" }));
  const tar = spawnSync("tar", ["-czf", path.join(sandbox, "tmp", "deploy.tar.gz"), "-C", stage, "."], { encoding: "utf8" });
  fs.rmSync(stage, { recursive: true, force: true });
  assert.equal(tar.status, 0, "tar failed: " + tar.stderr);
  const result = spawnSync("bash", [path.join(sandbox, "script.sh")], {
    encoding: "utf8",
    env: { HOME: path.join(sandbox, "home"), USER: "tester", PATH: path.join(sandbox, "bin") + ":/usr/bin:/bin" },
  });
  return { status: result.status, output: (result.stdout || "") + (result.stderr || "") };
}
function backups() {
  const root = path.join(sandbox, "backups");
  return fs.existsSync(root) ? fs.readdirSync(root).filter((name) => name.startsWith("SAR-backend-")).sort() : [];
}
function setNewestMtime(name, n) {
  const time = new Date(1700000000000 + n * 10000);
  fs.utimesSync(path.join(sandbox, "backups", name), time, time);
}

test("old backups are pruned to the newest three", () => {
  const names = [];
  for (let i = 1; i <= 6; i++) {
    const result = deploy(i);
    assert.equal(result.status, 0, result.output);
    const current = backups();
    const newest = current.find((name) => !names.includes(name));
    if (newest) {
      names.push(newest);
      setNewestMtime(newest, i);
    }
    assert.ok(current.length <= 3, "deploy " + i + " left " + current.length + " backups");
  }
  assert.equal(names.length, 5, "expected backups after the first deployment");
  assert.deepEqual(backups(), names.slice(-3).sort());
});

test("a failed backup aborts before the running app is touched", () => {
  const initial = deploy(20);
  assert.equal(initial.status, 0, initial.output);
  const app = path.join(sandbox, "app");
  const indexBefore = fs.readFileSync(path.join(app, "index.js"), "utf8");
  const markerBefore = fs.readFileSync(path.join(app, "node_modules", "marker"), "utf8");
  const priorBackups = new Set(backups());
  fs.writeFileSync(path.join(sandbox, "fail-backup"), "1");
  const result = deploy(21);
  assert.equal(result.status, 1, result.output);
  assert.equal(fs.readFileSync(path.join(app, "index.js"), "utf8"), indexBefore);
  assert.equal(fs.readFileSync(path.join(app, "node_modules", "marker"), "utf8"), markerBefore);
  assert.doesNotMatch(result.output, /pm2 stop/);
  assert.match(result.output, /aborting/i);
  assert.deepEqual(backups(), [...priorBackups].sort(), "partial backup was left behind");
});

test("a failed deploy keeps its backup for the rollback", () => {
  const initial = deploy(30);
  assert.equal(initial.status, 0, initial.output);
  fs.writeFileSync(path.join(sandbox, "curl-fails"), "1");
  const prior = new Set(backups());
  const result = deploy(31);
  assert.equal(result.status, 1, result.output);
  const created = backups().filter((name) => !prior.has(name));
  assert.equal(created.length, 1, "failed deploy backup was not retained");
  assert.ok(fs.statSync(path.join(sandbox, "backups", created[0])).isDirectory());
});
