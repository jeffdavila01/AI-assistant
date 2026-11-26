import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { requestCoordinator } from "../coding/generator/client.mjs";

const token = "mock-test-token-0123456789-0123456789";
const listen = handler => new Promise(resolve => { const server = http.createServer(handler).listen(0, "127.0.0.1", () => resolve(server)); });
const close = server => new Promise(resolve => server.close(resolve));

test("client passes stage and credentials only to the coordinator", async () => {
  let received;
  const server = await listen((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      received = { authorization: req.headers.authorization, data: JSON.parse(body) };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: "{}", doneReason: "stop" }));
    });
  });
  try {
    const result = await requestCoordinator([{ role: "user", content: "test" }], token, new AbortController().signal, { stage: "planning", port: server.address().port });
    assert.equal(result.doneReason, "stop");
    assert.equal(received.authorization, "Bearer " + token);
    assert.equal(received.data.stage, "planning");
  } finally { await close(server); }
});

test("missing credentials and unavailable coordinator fail clearly", async () => {
  await assert.rejects(requestCoordinator([], "", new AbortController().signal), /AI_COORDINATOR_TOKEN/);
  const server = await listen((_req, res) => res.end());
  const port = server.address().port;
  await close(server);
  await assert.rejects(requestCoordinator([], token, new AbortController().signal, { port }), /coordinator unavailable/i);
});

test("client cancellation closes a pending request", async () => {
  const server = await listen((_req, _res) => {});
  const controller = new AbortController();
  try {
    const pending = requestCoordinator([{ role: "user", content: "test" }], token, controller.signal, { port: server.address().port });
    setTimeout(() => controller.abort(new Error("cancelled")), 20);
    await assert.rejects(pending, /cancelled/);
  } finally { await close(server); }
});

test("context budget rejection retains its actionable error code", async () => {
  const server = await listen((_req, res) => {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "CONTEXT_BUDGET_EXCEEDED", error: "split the task" }));
  });
  try {
    await assert.rejects(requestCoordinator([{ role: "user", content: "test" }], token, new AbortController().signal, { port: server.address().port }),
      error => error.code === "CONTEXT_BUDGET_EXCEEDED" && /split the task/.test(error.message));
  } finally { await close(server); }
});
