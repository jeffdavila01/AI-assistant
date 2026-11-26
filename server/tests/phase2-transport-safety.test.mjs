import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startLocalCoordinator } from "../ai/coordinator.js";
import { getQueueStatus } from "../ai/requestQueue.js";

const token = "mock-transport-test-token-0123456789";
const listen = handler => new Promise(resolve => {
  const server = http.createServer(handler).listen(0, "127.0.0.1", () => resolve(server));
});
const close = server => new Promise(resolve => server.close(resolve));
function post(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/generate", method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on("error", reject);
    req.end(JSON.stringify({ messages: [{ role: "user", content: "mock request" }] }));
  });
}

for (const [description, reply] of [
  ["invalid JSON", res => res.end("not-json")],
  ["HTTP error", res => { res.statusCode = 500; res.end("error"); }],
  ["truncated response", res => {
    res.writeHead(200, { "Content-Length": "100" });
    res.write('{"message":');
    // A graceful socket close delivers the partial body before ending it.
    res.socket.end();
  }]
]) {
  test(`provider ${description} retains the marker and blocks the next request`, { timeout: 5000 }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-transport-safety-"));
    const marker = path.join(dir, "marker");
    const oldToken = process.env.AI_COORDINATOR_TOKEN;
    process.env.AI_COORDINATOR_TOKEN = token;
    let provider, coordinator, calls = 0;
    try {
      provider = await listen((req, res) => {
        calls++;
        req.resume();
        req.on("end", () => reply(res));
      });
      coordinator = await startLocalCoordinator({ port: 0, ollamaPort: provider.address().port, queueOptions: { marker } });
      const first = await post(coordinator.address().port);
      assert.equal(first.status, 503);
      await fs.stat(marker);
      assert.equal(getQueueStatus().providerStateUncertain, true);
      assert.equal((await post(coordinator.address().port)).status, 503);
      assert.equal(calls, 1);
    } finally {
      if (coordinator) await close(coordinator);
      if (provider) await close(provider);
      if (oldToken === undefined) delete process.env.AI_COORDINATOR_TOKEN;
      else process.env.AI_COORDINATOR_TOKEN = oldToken;
    }
  });
}

test("marker initialization failure closes the coordinator listener", { timeout: 5000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-transport-startup-"));
  const nonDirectory = path.join(dir, "file");
  await fs.writeFile(nonDirectory, "mock");
  const reservation = await listen((_req, res) => res.end());
  const port = reservation.address().port;
  await close(reservation);
  await assert.rejects(startLocalCoordinator({ port, queueOptions: { marker: path.join(nonDirectory, "marker") } }));
  const replacement = await new Promise((resolve, reject) => {
    const server = http.createServer().listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
  await close(replacement);
});
