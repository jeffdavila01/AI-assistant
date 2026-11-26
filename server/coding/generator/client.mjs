import http from "node:http";

export function requestCoordinator(messages, token, signal, { stage = "generation", port = 5002 } = {}) {
  if (typeof token !== "string" || token.length < 32) return Promise.reject(new Error("Set AI_COORDINATOR_TOKEN to the same secret of at least 32 characters used by the backend."));
  if (signal?.aborted) return Promise.reject(signal.reason || new Error("Request cancelled."));
  const configured = Number(process.env.AI_INITIALIZATION_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(configured) && configured >= 100 && configured <= 60000 ? configured : 5000;
  return new Promise((resolve, reject) => {
    let settled = false, responseBody = "";
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(initTimer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const request = http.request({ host: "127.0.0.1", port, path: "/generate", method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token } }, response => {
      response.setEncoding("utf8");
      response.on("data", chunk => {
        responseBody += chunk;
        if (responseBody.length > 1000000) request.destroy(new Error("Coordinator response exceeds the size limit."));
      });
      response.on("aborted", () => finish(new Error("Coordinator response interrupted.")));
      response.on("end", () => {
        try {
          const result = JSON.parse(responseBody);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(result.error || "Coordinator request failed.");
            if (response.statusCode === 413 && result.code === "CONTEXT_BUDGET_EXCEEDED") error.code = result.code;
            finish(error);
          }
          else finish(null, result);
        } catch { finish(new Error("Invalid coordinator response.")); }
      });
    });
    const abort = () => request.destroy(signal.reason || new Error("Request cancelled."));
    const initTimer = setTimeout(() => request.destroy(new Error("Coordinator connection initialization timed out.")), timeoutMs);
    request.on("socket", socket => {
      if (!socket.connecting) clearTimeout(initTimer);
      else socket.once("connect", () => clearTimeout(initTimer));
    });
    request.on("error", error => finish(signal?.aborted ? (signal.reason || error) :
      error.code === "ECONNREFUSED" ? new Error("Central inference coordinator unavailable; start the backend first.") : error));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    request.end(JSON.stringify({ messages, stage }));
  });
}
