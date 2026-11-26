import test from "node:test";
import assert from "node:assert/strict";
import { runProbe } from "../coding/generator/probe.mjs";

test("bounded probe uses the coordinator and reports metrics without model content", async () => {
  let seen;
  const report = await runProbe({ token: "mock-token", request: async (...args) => {
    seen = args;
    return { content: '{"probe":"ok"}', doneReason: "stop", evalCount: 10, evalDuration: 2e9 };
  } });
  assert.equal(seen[1], "mock-token");
  assert.equal(seen[3].stage, "generation");
  assert.equal(report.transportCompleted, true);
  assert.equal(report.validResponse, true);
  assert.equal(report.tokensPerSecond, 5);
  assert.equal(Object.hasOwn(report, "content"), false);
});

test("probe reports invalid or truncated response without echoing it", async () => {
  const report = await runProbe({ request: async () => ({ content: "private output", doneReason: "length" }) });
  assert.equal(report.validResponse, false);
  assert.equal(JSON.stringify(report).includes("private output"), false);
});

test("probe timeout detaches the caller and reports provider may still drain", async () => {
  await assert.rejects(runProbe({ timeoutMs: 100, request: (_messages, _token, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) }), /provider may still be draining/);
  await assert.rejects(runProbe({ timeoutMs: 900001 }), /Probe timeout/);
});
