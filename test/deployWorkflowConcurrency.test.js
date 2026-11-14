// Two deploy runs must never work on the host at the same time: they share
// /tmp/deploy.tar.gz, the app directory and the PM2 process, and the smoke test
// (GET /health) cannot tell one build from another. The workflow therefore has to
// queue runs, and must not cancel one that is already on the host.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "aws.yml"), "utf8");

// Returns the lines of a top-level block ("key:" at column 0 and its indented body).
function topLevelBlock(key) {
    const lines = workflow.split("\n");
    const start = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (start === -1) return null;
    const body = [];
    for (const line of lines.slice(start + 1)) {
        if (/^\S/.test(line)) break;
        body.push(line);
    }
    return body.join("\n");
}

test("deploy workflow queues overlapping runs instead of running them together", () => {
    const block = topLevelBlock("concurrency");
    assert.ok(block, "aws.yml has no top-level concurrency block");
    assert.match(block, /^\s+group:\s*deploy-gplay-production\s*$/m);
});

test("a deploy that is already running on the host is never cancelled", () => {
    const block = topLevelBlock("concurrency") || "";
    assert.match(block, /^\s+cancel-in-progress:\s*false\s*$/m);
});
