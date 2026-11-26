import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { startLocalCoordinator } from "../ai/coordinator.js";
import { requestCoordinator } from "../coding/generator/client.mjs";
import { getQueueStatus } from "../ai/requestQueue.js";

test("coordinator applies coding resource settings", {
  timeout: 15000
}, async t => {

  const root = path.join(
    process.env.LOCALAPPDATA,
    "AI-assistant",
    "projects"
  );

  const stat = await fs.lstat(root);

  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Invalid test workspace.");
  }

  const fixture = await fs.mkdtemp(
    path.join(root, "resource-integration-")
  );

  const marker = path.join(fixture, ".test-inference-active");

  const settings = {
    AI_COORDINATOR_TOKEN: randomBytes(48).toString("hex"),
    AI_CODING_CONTEXT_TOKENS: "3072",
    AI_CODING_PLANNING_OUTPUT_TOKENS: "768",
    AI_CODING_GENERATION_OUTPUT_TOKENS: "1200"
  };

  const previous = {};

  for (const [key, value] of Object.entries(settings)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }

  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const requests = [];

  const mockProvider = http.createServer(async (req, res) => {
    let body = "";

    for await (const chunk of req) {
      body += chunk;
    }

    requests.push(JSON.parse(body));

    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      message: { content: '{"result":"ok"}' },
      done_reason: "stop",
      eval_count: 10,
      eval_duration: 1000000000
    }));
  });

  await new Promise((resolve, reject) => {
    mockProvider.once("error", reject);
    mockProvider.listen(0, "127.0.0.1", resolve);
  });

  t.after(() => new Promise(resolve => {
    mockProvider.close(resolve);
    mockProvider.closeAllConnections();
  }));

  const coordinator = await startLocalCoordinator({
    port: 0,
    ollamaPort: mockProvider.address().port,
    queueOptions: { marker }
  });

  t.after(() => new Promise(resolve => {
    coordinator.close(resolve);
    coordinator.closeAllConnections();
  }));

  const port = coordinator.address().port;
  const token = settings.AI_COORDINATOR_TOKEN;
  const signal = new AbortController().signal;

  const messages = [
    { role: "user", content: "Create a Python function." }
  ];

  await requestCoordinator(messages, token, signal, {
    stage: "planning",
    port
  });

  assert.equal(requests[0].options.num_ctx, 3072);
  assert.equal(requests[0].options.num_predict, 768);
  assert.equal(requests[0].options.num_thread, 4);

  console.log("PASS: Planning configuration applied.");

  await requestCoordinator(messages, token, signal, {
    stage: "generation",
    port
  });

  assert.equal(requests[1].options.num_ctx, 3072);
  assert.equal(requests[1].options.num_predict, 1200);

  console.log("PASS: Generation configuration applied.");

  await assert.rejects(
    requestCoordinator(
      [{ role: "user", content: "x".repeat(20000) }],
      token,
      signal,
      { stage: "planning", port }
    ),
    error => error.code === "CONTEXT_BUDGET_EXCEEDED"
  );

  assert.equal(requests.length, 2);

  console.log("PASS: Oversized prompt rejected before inference.");

  process.env.AI_CODING_CONTEXT_TOKENS = "999999";

  await assert.rejects(
    requestCoordinator(messages, token, signal, {
      stage: "planning",
      port
    }),
    /Invalid coding resource setting/
  );

  assert.equal(requests.length, 2);

  console.log("PASS: Invalid configuration rejected before inference.");

  const status = getQueueStatus();

  assert.equal(status.active, 0);
  assert.equal(status.waiting, 0);
  assert.equal(status.providerStateUncertain, false);

  await assert.rejects(
    fs.lstat(marker),
    error => error.code === "ENOENT"
  );

  console.log("PASS: Test queue and marker lifecycle.");
  console.log("No real Ollama inference performed.");
});