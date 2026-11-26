import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { assessCodingBudget } from "../ai/codingBudget.js";
import { startLocalCoordinator } from "../ai/coordinator.js";
import { getQueueStatus } from "../ai/requestQueue.js";

test("coding budget reports a UTF-8 estimate with output and safety reserves", () => {
  const plain = assessCodingBudget([{ role: "user", content: "abc" }]);
  const unicode = assessCodingBudget([{ role: "user", content: "界界界" }]);
  assert.equal(plain.inputBudget, 2640);
  assert.ok(unicode.inputBytes > plain.inputBytes);
  assert.ok(unicode.estimatedInputTokens >= plain.estimatedInputTokens);
  assert.equal(plain.exceedsEstimate, false);
  assert.equal(assessCodingBudget([{ role: "user", content: "x".repeat(9000) }]).exceedsEstimate, true);
});

test("oversized estimated coding context is rejected before provider or marker use", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-budget-test-"));
  const marker = path.join(dir, "marker");
  const oldToken = process.env.AI_COORDINATOR_TOKEN;
  process.env.AI_COORDINATOR_TOKEN = "mock-budget-token-0123456789-0123456789";
  let server;
  try {
    server = await startLocalCoordinator({ port: 0, queueOptions: { marker } });
    const response = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: "/generate", method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + process.env.AI_COORDINATOR_TOKEN } }, res => {
        let body = ""; res.on("data", chunk => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ messages: [{ role: "user", content: "x".repeat(9000) }] }));
    });
    assert.equal(response.status, 413);
    assert.match(response.body, /split the task/);
    assert.equal(getQueueStatus().active, 0);
    assert.equal(getQueueStatus().providerStateUncertain, false);
    await assert.rejects(fs.stat(marker), { code: "ENOENT" });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (oldToken === undefined) delete process.env.AI_COORDINATOR_TOKEN; else process.env.AI_COORDINATOR_TOKEN = oldToken;
  }
});
