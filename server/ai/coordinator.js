import express from "express";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import os from "node:os";
import { enableLocalCoordinator, enqueueLocalAI } from "./requestQueue.js";
import { assessCodingBudget, getCodingProfile } from "./codingBudget.js";

// A fixed, exclusive loopback listener establishes a single application owner.
// External applications that call Ollama directly are outside this guarantee.
const COORDINATOR_PORT = 5002;
const OLLAMA_PORT = 11434;
const MAX_PROVIDER_RESPONSE_BYTES = 1000000;
const transportCodes = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "ABORT_ERR"]);
function safeCode(error) {
  const code = error?.code ?? error?.cause?.code;
  return transportCodes.has(code) ? code : "unknown";
}
function stageTimeout(name) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 100 && value <= 3600000 ? value : 900000;
}

function authenticated(header, secret) {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const received = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Unlike fetch's hidden headers deadline, the core HTTP client has no implicit
// inference timeout. The queue owns caller deadlines and keeps draining after a
// caller detaches; transport failures still retain the safety marker.
function requestOllama(payload, port, onHeaders) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/api/chat", method: "POST",
      agent: false, headers: { "Content-Type": "application/json" } }, response => {
      onHeaders(response.statusCode);
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
          response.destroy(new Error("Provider response exceeds the size limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("aborted", () => reject(new Error("Provider response interrupted.")));
      response.on("error", reject);
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error("Provider HTTP error."));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("Invalid provider response JSON.")); }
      });
    });
    request.setTimeout(0);
    request.on("error", reject);
    request.end(JSON.stringify(payload));
  });
}

export async function startLocalCoordinator({ port = COORDINATOR_PORT, queueOptions, ollamaPort = OLLAMA_PORT } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb", strict: true }));
  app.post("/generate", async (req, res) => {
    const token = process.env.AI_COORDINATOR_TOKEN;
    if (!token || token.length < 32) return res.status(503).json({ error: "Set AI_COORDINATOR_TOKEN to a secret of at least 32 characters in the server and CLI environment." });
    if (!authenticated(req.get("authorization"), token)) return res.status(401).json({ error: "Unauthorized." });
    const { messages, stage = "generation" } = req.body || {};
    if (!["planning", "generation"].includes(stage)) return res.status(400).json({ error: "Invalid inference stage." });
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 4 ||
      messages.some(m => !m || !["system", "user"].includes(m.role) || typeof m.content !== "string" || !m.content.trim() || m.content.length > 24000)) {
      return res.status(400).json({ error: "Invalid generation request." });
    }
    let profile;
    try {
      profile = getCodingProfile(stage);
    } catch (error) {
      return res.status(503).json({
        error: error.message
      });
    }

    const budget = assessCodingBudget(messages, profile);
    if (budget.exceedsEstimate) return res.status(413).json({ code: "CONTEXT_BUDGET_EXCEEDED", error: "Estimated prompt exceeds the coding context budget; split the task or reduce supplied context without dropping requirements." });
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const result = await enqueueLocalAI(async () => {
        const started = Date.now();
        let phase = "connect-or-load", status;
        console.info("[local-inference]", JSON.stringify({ event: "provider-start", stage, pid: process.pid, at: new Date().toISOString(),
          estimatedInputTokens: budget.estimatedInputTokens, inputBudget: budget.inputBudget, contextTokens: profile.contextTokens, outputTokens: profile.outputTokens, availableMemoryMiB: Math.floor(os.freemem() / 1048576) }));
        try {
          const result = await requestOllama({
            model: "qwen2.5-coder:7b", stream: false, keep_alive: "10m", format: "json",
            messages, options: { temperature: 0.1, num_thread: 4, num_ctx: profile.contextTokens, num_predict: profile.outputTokens }
          }, ollamaPort, code => { status = code; phase = "response"; });
          if (typeof result.message?.content !== "string") throw new Error("Invalid Ollama response.");
          console.info("[local-inference]", JSON.stringify({ event: "provider-complete", stage, pid: process.pid, durationMs: Date.now() - started }));
          return { content: result.message.content, doneReason: result.done_reason,
            totalDuration: result.total_duration, evalCount: result.eval_count, evalDuration: result.eval_duration,
            promptEvalCount: result.prompt_eval_count, promptEvalDuration: result.prompt_eval_duration };
        } catch (error) {
          console.error("[local-inference]", JSON.stringify({ event: "provider-error", stage, pid: process.pid,
            phase, durationMs: Date.now() - started, code: safeCode(error),
            ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}) }));
          throw new Error("Local inference provider request failed; inspect backend diagnostics.");
        }
      }, controller.signal, undefined, { activeMs: stageTimeout(stage === "planning" ? "AI_PLANNING_TIMEOUT_MS" : "AI_GENERATION_TIMEOUT_MS") });
      if (!res.destroyed) res.json(result);
    } catch (error) {
      if (!res.destroyed) res.status(503).json({ error: error.message });
    }
  });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  try {
    enableLocalCoordinator(queueOptions);
  } catch (error) {
    // Do not leave an apparently healthy listener behind when marker setup
    // failed: the coordinator cannot safely accept inference requests.
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
  return server;
}
