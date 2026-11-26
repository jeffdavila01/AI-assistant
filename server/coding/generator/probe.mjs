import { pathToFileURL } from "node:url";
import { requestCoordinator } from "./client.mjs";

// This probe has no project filesystem access and never evaluates model output.
// A caller deadline detaches the client; the coordinator may continue draining.
export async function runProbe({ token, timeoutMs = 600000, request = requestCoordinator } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 900000) throw new Error("Probe timeout must be 100–900000 ms.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Probe caller deadline elapsed; the provider may still be draining.")), timeoutMs);
  const started = Date.now();
  try {
    const result = await request([
      { role: "system", content: 'Return only the JSON object {"probe":"ok"}.' },
      { role: "user", content: "Return the requested object." }
    ], token, controller.signal, { stage: "generation" });
    let valid = false;
    try {
      const parsed = JSON.parse(result.content);
      valid = parsed && !Array.isArray(parsed) && Object.keys(parsed).length === 1 && parsed.probe === "ok";
    } catch { /* A transport response is not proof of a valid model response. */ }
    return { transportCompleted: true, validResponse: Boolean(valid && result.doneReason === "stop"),
      doneReason: ["stop", "length", "load", "unload"].includes(result.doneReason) ? result.doneReason : "unknown",
      elapsedMs: Date.now() - started,
      evalCount: Number.isFinite(result.evalCount) ? result.evalCount : null,
      promptEvalCount: Number.isFinite(result.promptEvalCount) ? result.promptEvalCount : null,
      tokensPerSecond: result.evalCount > 0 && result.evalDuration > 0 ? result.evalCount / (result.evalDuration / 1e9) : null };
  } finally { clearTimeout(timer); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--timeout-ms" || !/^\d+$/.test(args[1]))) throw new Error("Usage: probe.mjs [--timeout-ms 100..900000]");
  const report = await runProbe({ token: process.env.AI_COORDINATOR_TOKEN, timeoutMs: args.length ? Number(args[1]) : 600000 });
  console.log(JSON.stringify(report));
  if (!report.validResponse) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error("Probe stopped: " + error.message); process.exitCode = 1; });
}
