// The backend must only listen on loopback: nginx on the same host is its only client
// (smar.nginx.conf proxies to 127.0.0.1:5001). The periodic health check is replaced
// with a counter, so nothing contacts the store.
const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const net = require("node:net");

// An empty value is kept by dotenv and falls back to the default host, so a
// developer's own LISTEN_HOST does not change what is tested here.
process.env.LISTEN_HOST = "";

const healthCheck = require("../utilities/healthCheck");

let healthCheckStarts = 0;
healthCheck.startPeriodicHealthCheck = () => {
    healthCheckStarts += 1;
};

const app = require("../index");
let server;

test.before(async () => {
    server = app.start(0);
    await new Promise((resolve) => server.once("listening", resolve));
});

test.after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("start listens on loopback and serves health", async (t) => {
    const port = server.address().port;
    assert.strictEqual(server.address().address, "127.0.0.1");
    assert.strictEqual(healthCheckStarts, 1);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.strictEqual(response.status, 200);

    const externalAddress = Object.values(os.networkInterfaces())
        .flat()
        .find((entry) => entry && entry.family === "IPv4" && !entry.internal);

    if (!externalAddress) {
        t.skip("No non-internal IPv4 address is available to check");
        return;
    }

    // Refused, unreachable or timed out all mean "not listening there".
    const connected = await new Promise((resolve) => {
        const socket = net.connect(port, externalAddress.address);
        socket.setTimeout(2000);
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", () => {
            socket.destroy();
            resolve(false);
        });
        socket.once("timeout", () => {
            socket.destroy();
            resolve(false);
        });
    });

    assert.strictEqual(connected, false, "the server must not accept connections on an external address");
});
