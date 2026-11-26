import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import chatRoutes from "../routes/chat.js";
import { prepareSearch, formatSources } from "../tools/search/searchRouter.js";

function post(port, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/stream", method: "POST", headers: { "content-type": "application/json" } }, response => {
      let text = ""; response.on("data", chunk => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, text }));
    });
    request.on("error", reject); request.end(JSON.stringify(body));
  });
}

test("chat route validates input and preserves streamed system replies", async () => {
  const app = express(); app.use(express.json()); app.use(chatRoutes);
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const port = server.address().port;
    assert.equal((await post(port, { messages: [] })).status, 400);
    assert.equal((await post(port, { messages: [{ role: "user", content: "hello" }], model: "unsupported" })).status, 400);
    const result = await post(port, { messages: [{ role: "user", content: "hello" }], model: "auto" });
    assert.equal(result.status, 200);
    const events = result.text.trim().split("\n").map(JSON.parse);
    assert.ok(events.some(event => event.type === "delta" && event.text.includes("Hello")));
    assert.ok(events.some(event => event.type === "done"));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("coding research normalizes mocked providers and formats citations", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes("developer.mozilla.org")) return new Response(JSON.stringify({ documents: [
      { title: "Fetch API", summary: "Fetch resources.", mdn_url: "/en-US/docs/Web/API/Fetch_API" }
    ] }), { status: 200 });
    return new Response(JSON.stringify({ items: [
      { title: "Fetch example", link: "https://stackoverflow.com/questions/12345/example", body: "Fetch example", score: 1, is_answered: true }
    ] }), { status: 200 });
  };
  try {
    const events = [];
    const result = await prepareSearch("unique-phase2-fetch-regression", new AbortController().signal, event => events.push(event));
    assert.equal(result.sources.length, 2);
    assert.ok(events.some(event => event.type === "search_results"));
    assert.match(formatSources(result.sources), /developer\.mozilla\.org/);
    assert.match(result.context, /untrusted/i);
  } finally { globalThis.fetch = original; }
});

test("research deadline cancels provider work and returns an honest fallback", async () => {
  const original = globalThis.fetch, old = process.env.AI_RESEARCH_TIMEOUT_MS;
  process.env.AI_RESEARCH_TIMEOUT_MS = "500";
  let aborted = 0;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted++; reject(signal.reason); }, { once: true });
  });
  try {
    const result = await prepareSearch("unique-phase2-research-deadline", new AbortController().signal, () => {});
    assert.equal(result.sources.length, 0);
    assert.match(result.context, /unavailable/i);
    assert.equal(aborted, 2);
  } finally {
    globalThis.fetch = original;
    if (old === undefined) delete process.env.AI_RESEARCH_TIMEOUT_MS; else process.env.AI_RESEARCH_TIMEOUT_MS = old;
  }
});
