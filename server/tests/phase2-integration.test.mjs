import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startLocalCoordinator } from "../ai/coordinator.js";
import { getQueueStatus } from "../ai/requestQueue.js";
import { streamResponse } from "../ai/streaming.js";
import { getMemoryContext } from "../memory/store.js";
import { getSearchQuery, prepareSearch } from "../tools/search/searchRouter.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const listenProvider = handler => new Promise(resolve => {
  const server = http.createServer(handler).listen(0, "127.0.0.1", () => resolve(server));
});
const closeServer = server => new Promise(resolve => server.close(resolve));
function post(port, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/generate", method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token } }, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

test("chat and generator share one coordinator, and the endpoint requires a token", { timeout: 5000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-integration-"));
  const oldFetch = globalThis.fetch, oldToken = process.env.AI_COORDINATOR_TOKEN;
  const token = "mock-test-token-0123456789-0123456789";
  process.env.AI_COORDINATOR_TOKEN = token;
  let streamControl, calls = 0;
  const encoder = new TextEncoder();
  globalThis.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    if (body.stream) {
      const bodyStream = new ReadableStream({ start(controller) {
        streamControl = controller;
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: "mock" }, done: false }) + "\n"));
      } });
      return new Response(bodyStream, { status: 200 });
    }
    throw new Error("Unexpected chat fetch");
  };
  let server, provider;
  try {
    provider = await listenProvider((req, res) => {
      calls++;
      req.resume();
      req.on("end", () => res.end(JSON.stringify({ message: { content: '{"code":"ok"}' }, done_reason: "stop" })));
    });
    server = await startLocalCoordinator({ port: 0, ollamaPort: provider.address().port, queueOptions: { marker: path.join(dir, "marker"), queueMs: 1000, activeMs: 2000 } });
    const port = server.address().port;
    assert.equal((await post(port, "wrong", { messages: [] })).status, 401);
    const chatEvents = [];
    const chat = streamResponse([{ role: "user", content: "Explain JavaScript code" }], "qwen2.5-coder:7b", new AbortController().signal, e => chatEvents.push(e));
    for (let i = 0; i < 100 && !streamControl; i++) await delay(5);
    assert.ok(streamControl);
    const coding = post(port, token, { messages: [{ role: "user", content: "Generate one file" }] });
    for (let i = 0; i < 100 && !getQueueStatus().waiting; i++) await delay(5);
    assert.equal(getQueueStatus().waiting, 1);
    assert.equal(calls, 1);
    streamControl.enqueue(encoder.encode(JSON.stringify({ done: true }) + "\n"));
    streamControl.close();
    await chat;
    assert.ok(chatEvents.some(e => e.type === "done"));
    assert.equal((await coding).status, 200);
    assert.equal(calls, 2);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (provider) await closeServer(provider);
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.AI_COORDINATOR_TOKEN; else process.env.AI_COORDINATOR_TOKEN = oldToken;
  }
});

test("chat system routing, memory context and search query selection remain available", async () => {
  const events = [];
  await streamResponse([{ role: "user", content: "hello" }], "auto", new AbortController().signal, e => events.push(e));
  assert.ok(events.some(e => e.type === "done"));
  assert.equal(typeof getMemoryContext([]), "string");
  assert.equal(getSearchQuery([{ role: "user", content: "/search JavaScript fetch" }]), "JavaScript fetch");
  assert.equal(getSearchQuery([{ role: "user", content: "hello" }]), null);
});

test("coding research propagates cancellation to provider fetches", async () => {
  const original = globalThis.fetch;
  let seen = 0;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    seen++;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const controller = new AbortController();
  try {
    const pending = prepareSearch("unique-uncached-abort-probe", controller.signal, () => {});
    controller.abort(new Error("cancelled"));
    await assert.rejects(pending, /cancelled/);
    assert.equal(seen, 2);
  } finally { globalThis.fetch = original; }
});

test("coordinator rejects missing credentials and invalid inference stages", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-auth-"));
  const oldToken = process.env.AI_COORDINATOR_TOKEN;
  delete process.env.AI_COORDINATOR_TOKEN;
  let server;
  try {
    server = await startLocalCoordinator({ port: 0, queueOptions: { marker: path.join(dir, "marker") } });
    const port = server.address().port;
    assert.equal((await post(port, "anything", { messages: [{ role: "user", content: "test" }] })).status, 503);
    const token = "mock-test-token-0123456789-0123456789";
    process.env.AI_COORDINATOR_TOKEN = token;
    assert.equal((await post(port, token, { stage: "execute", messages: [{ role: "user", content: "test" }] })).status, 400);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (oldToken === undefined) delete process.env.AI_COORDINATOR_TOKEN; else process.env.AI_COORDINATOR_TOKEN = oldToken;
  }
});

test("mocked provider disconnect logs safe transport details and retains the marker", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-transport-"));
  const marker = path.join(dir, "marker");
  const oldToken = process.env.AI_COORDINATOR_TOKEN;
  const oldError = console.error, logs = [];
  const token = "mock-test-token-0123456789-0123456789";
  process.env.AI_COORDINATOR_TOKEN = token;
  console.error = (...args) => logs.push(args.join(" "));
  let server, provider;
  try {
    provider = await listenProvider((req) => { req.resume(); req.on("end", () => req.socket.destroy()); });
    server = await startLocalCoordinator({ port: 0, ollamaPort: provider.address().port, queueOptions: { marker } });
    const result = await post(server.address().port, token, { stage: "planning", messages: [{ role: "user", content: "private prompt" }] });
    assert.equal(result.status, 503);
    assert.match(result.body.error, /provider request failed/);
    assert.match(logs.join("\n"), /ECONNRESET/);
    assert.match(logs.join("\n"), /connect-or-load/);
    assert.doesNotMatch(logs.join("\n"), /private prompt|secret|mock-test-token/);
    assert.doesNotMatch(result.body.error, /private prompt|secret/);
    assert.equal(getQueueStatus().providerStateUncertain, true);
    await fs.stat(marker);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (provider) await closeServer(provider);
    console.error = oldError;
    if (oldToken === undefined) delete process.env.AI_COORDINATOR_TOKEN; else process.env.AI_COORDINATOR_TOKEN = oldToken;
  }
});

test("mocked active provider drains after HTTP client disconnect before next request starts", { timeout: 5000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-disconnect-"));
  const marker = path.join(dir, "marker");
  const oldToken = process.env.AI_COORDINATOR_TOKEN;
  const token = "mock-test-token-0123456789-0123456789";
  process.env.AI_COORDINATOR_TOKEN = token;
  let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  let providerResponse;
  const handleProvider = async (req, res) => {
    req.resume();
    await new Promise(resolve => req.on("end", resolve));
    calls++;
    if (calls === 1) { providerResponse = res; await pending; }
    res.end(JSON.stringify({ message: { content: "ok" }, done_reason: "stop" }));
  };
  let server, request, provider;
  try {
    provider = await listenProvider(handleProvider);
    server = await startLocalCoordinator({ port: 0, ollamaPort: provider.address().port, queueOptions: { marker, queueMs: 2000, activeMs: 2000 } });
    const port = server.address().port;
    request = http.request({ hostname: "127.0.0.1", port, path: "/generate", method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token } });
    request.on("error", () => {});
    request.end(JSON.stringify({ messages: [{ role: "user", content: "first" }] }));
    for (let i = 0; i < 100 && calls === 0; i++) await delay(5);
    assert.equal(calls, 1);
    request.destroy();
    const second = post(port, token, { messages: [{ role: "user", content: "second" }] });
    for (let i = 0; i < 100 && !getQueueStatus().waiting; i++) await delay(5);
    assert.equal(getQueueStatus().active, 1);
    assert.equal(getQueueStatus().waiting, 1);
    assert.equal(calls, 1);
    await fs.stat(marker);
    await delay(200);
    assert.equal(providerResponse.destroyed, false);
    assert.equal(calls, 1);
    release();
    assert.equal((await second).status, 200);
    assert.equal(calls, 2);
  } finally {
    release();
    request?.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    if (provider) await closeServer(provider);
    if (oldToken === undefined) delete process.env.AI_COORDINATOR_TOKEN; else process.env.AI_COORDINATOR_TOKEN = oldToken;
  }
});

test("caller deadline does not terminate a provider waiting for delayed headers", { timeout: 5000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-delayed-headers-"));
  const marker = path.join(dir, "marker");
  const oldToken = process.env.AI_COORDINATOR_TOKEN, oldTimeout = process.env.AI_PLANNING_TIMEOUT_MS;
  const token = "mock-test-token-0123456789-0123456789";
  process.env.AI_COORDINATOR_TOKEN = token;
  process.env.AI_PLANNING_TIMEOUT_MS = "100";
  let release, calls = 0, firstResponse;
  const pending = new Promise(resolve => { release = resolve; });
  let server, provider;
  try {
    provider = await listenProvider(async (req, res) => {
      req.resume();
      await new Promise(resolve => req.on("end", resolve));
      calls++;
      if (calls === 1) { firstResponse = res; await pending; }
      res.end(JSON.stringify({ message: { content: "ok" }, done_reason: "stop" }));
    });
    server = await startLocalCoordinator({ port: 0, ollamaPort: provider.address().port, queueOptions: { marker, queueMs: 2000 } });
    const port = server.address().port;
    const result = await post(port, token, { stage: "planning", messages: [{ role: "user", content: "first" }] });
    assert.equal(result.status, 503);
    assert.match(result.body.error, /Active inference timed out/);
    assert.equal(getQueueStatus().active, 1);
    assert.equal(firstResponse.destroyed, false);
    await fs.stat(marker);
    const second = post(port, token, { messages: [{ role: "user", content: "second" }] });
    for (let i = 0; i < 100 && !getQueueStatus().waiting; i++) await delay(5);
    assert.equal(getQueueStatus().waiting, 1);
    assert.equal(calls, 1);
    release();
    assert.equal((await second).status, 200);
    assert.equal(calls, 2);
  } finally {
    release();
    if (server) await closeServer(server);
    if (provider) await closeServer(provider);
    if (oldToken === undefined) delete process.env.AI_COORDINATOR_TOKEN; else process.env.AI_COORDINATOR_TOKEN = oldToken;
    if (oldTimeout === undefined) delete process.env.AI_PLANNING_TIMEOUT_MS; else process.env.AI_PLANNING_TIMEOUT_MS = oldTimeout;
  }
});

test("oversized provider response fails closed", { timeout: 5000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-provider-limit-"));
  const marker = path.join(dir, "marker");
  const oldToken = process.env.AI_COORDINATOR_TOKEN;
  const token = "mock-test-token-0123456789-0123456789";
  process.env.AI_COORDINATOR_TOKEN = token;
  let server, provider;
  try {
    provider = await listenProvider((req, res) => {
      req.resume();
      req.on("end", () => res.end("x".repeat(1000001)));
    });
    server = await startLocalCoordinator({ port: 0, ollamaPort: provider.address().port, queueOptions: { marker } });
    const result = await post(server.address().port, token, { messages: [{ role: "user", content: "test" }] });
    assert.equal(result.status, 503);
    assert.equal(getQueueStatus().providerStateUncertain, true);
    await fs.stat(marker);
  } finally {
    if (server) await closeServer(server);
    if (provider) await closeServer(provider);
    if (oldToken === undefined) delete process.env.AI_COORDINATOR_TOKEN; else process.env.AI_COORDINATOR_TOKEN = oldToken;
  }
});
