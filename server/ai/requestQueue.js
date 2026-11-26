import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The marker is retained on uncertain provider failure or process death.
function boundedEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
export function createLocalQueue({
  marker = fileURLToPath(new URL("../../workspace/.local-inference-active", import.meta.url)),
  queueMs = boundedEnv("AI_QUEUE_TIMEOUT_MS", 900000, 100, 3600000),
  activeMs = boundedEnv("AI_ACTIVE_TIMEOUT_MS", 900000, 100, 3600000)
} = {}) {
const waiting = [];
let active = false;
let enabled = false;
let uncertain = false;

function enable() {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  uncertain = fs.existsSync(marker);
  enabled = true;
}

function unavailable() {
  return new Error("Local inference is blocked: the prior provider request may still be running. Verify Ollama has stopped before resolving the retained workspace/.local-inference-active marker.");
}

function drain() {
  if (active || !waiting.length) return;
  if (!enabled || uncertain) {
    while (waiting.length) waiting.shift().finish(unavailable());
    return;
  }
  const item = waiting.shift();
  clearTimeout(item.queueTimer);
  if (item.signal.aborted) { item.finish(item.signal.reason || new Error("Request cancelled.")); drain(); return; }
  try {
    fs.writeFileSync(marker, JSON.stringify({ startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    uncertain = true;
    item.finish(new Error(`Unable to establish inference safety marker: ${error.code || error.message}`));
    drain();
    return;
  }
  active = true;
  item.started = true;
  // Detach cancelled callers, but drain the provider to completion. Aborting the
  // HTTP stream does not prove the underlying model has stopped processing.
  item.activeTimer = setTimeout(() => item.finish(new Error("Active inference timed out; provider is still being drained.")), item.activeMs);
  Promise.resolve().then(() => item.task()).then(value => {
    try { fs.unlinkSync(marker); }
    catch { uncertain = true; }
    item.finish(uncertain ? unavailable() : null, value);
  }, error => {
    uncertain = true;
    item.finish(error);
  }).finally(() => { active = false; drain(); });
}

function enqueue(task, signal, onEvent = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    if (!enabled) return reject(new Error("Local inference coordinator is unavailable."));
    if (uncertain) return reject(unavailable());
    if (signal.aborted) return reject(signal.reason || new Error("Request cancelled."));
    if (waiting.length >= 5) return reject(new Error("Local AI queue is full."));
    const deadline = Number.isInteger(options.activeMs) && options.activeMs >= 100 && options.activeMs <= 3600000 ? options.activeMs : activeMs;
    const item = { task, signal, started: false, settled: false, activeMs: deadline };
    item.finish = (error, value) => {
      if (item.settled) return;
      item.settled = true;
      clearTimeout(item.queueTimer);
      clearTimeout(item.activeTimer);
      signal.removeEventListener("abort", item.onAbort);
      if (error) reject(error); else resolve(value);
    };
    item.onAbort = () => {
      if (!item.started) {
        const index = waiting.indexOf(item);
        if (index !== -1) waiting.splice(index, 1);
      }
      item.finish(signal.reason || new Error("Request cancelled."));
    };
    signal.addEventListener("abort", item.onAbort, { once: true });
    item.queueTimer = setTimeout(() => {
      const index = waiting.indexOf(item);
      if (index !== -1) waiting.splice(index, 1);
      item.finish(new Error("Local AI queue wait timed out."));
    }, queueMs);
    waiting.push(item);
    if (active) onEvent({ type: "queued", position: waiting.length });
    drain();
  });
}

function status() {
  return { active: active ? 1 : 0, waiting: waiting.length, concurrencyLimit: 1, available: enabled && !uncertain, providerStateUncertain: uncertain };
}
return { enable, enqueue, status };
}

let singleton = createLocalQueue();
export function enableLocalCoordinator(options) {
  if (options) singleton = createLocalQueue(options);
  singleton.enable();
}
export const enqueueLocalAI = (...args) => singleton.enqueue(...args);
export const getQueueStatus = () => singleton.status();
