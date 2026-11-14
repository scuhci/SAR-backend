// The server must only listen on loopback. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const net = require('node:net');
const { startServer } = require('./support/server');

function externalIPv4() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return undefined;
}

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(3000);
    socket.once('connect', () => resolve(socket));
    socket.once('error', (error) => {
      socket.destroy();
      reject(error);
    });
    socket.once('timeout', () => {
      const error = new Error('connection timed out');
      error.code = 'ETIMEDOUT';
      socket.destroy();
      reject(error);
    });
  });
}

test('the server answers on loopback but refuses connections on the machine\'s network address', async (t) => {
  const address = externalIPv4();
  if (!address) {
    t.skip('no external IPv4 interface');
    return;
  }

  const server = await startServer();
  try {
    const response = await fetch(`${server.base}/health`);
    assert.equal(response.status, 200);

    const port = Number(new URL(server.base).port);
    let socket;
    try {
      socket = await connect(address, port);
      assert.fail('connection to the network address unexpectedly succeeded');
    } catch (error) {
      assert.equal(error.code, 'ECONNREFUSED');
    } finally {
      socket?.destroy();
    }
  } finally {
    await server.stop();
  }
});

test('LISTEN_HOST overrides the listen address', async (t) => {
  const address = externalIPv4();
  if (!address) {
    t.skip('no external IPv4 interface');
    return;
  }

  const server = await startServer({ LISTEN_HOST: '0.0.0.0' });
  let socket;
  try {
    const port = Number(new URL(server.base).port);
    socket = await connect(address, port);
  } finally {
    socket?.destroy();
    await server.stop();
  }
});
