import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const childFile = fileURLToPath(new URL("./coordinator-child.mjs", import.meta.url));
function start(port, marker) {
  return spawn(process.execPath, [childFile, String(port), marker], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}
function ready(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    child.on("error", reject);
    child.stdout.on("data", chunk => {
      output += chunk;
      const match = output.match(/READY (\d+)/);
      if (match) resolve(Number(match[1]));
    });
    child.on("exit", code => reject(new Error("Coordinator exited before ready: " + code)));
  });
}
function exited(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

test("only one process can own a coordinator listener", { timeout: 10000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-owner-"));
  const first = start(0, path.join(dir, "first-marker"));
  try {
    const port = await ready(first);
    const second = start(port, path.join(dir, "second-marker"));
    const outcome = await exited(second);
    assert.notEqual(outcome.code, 0);
    assert.equal(first.exitCode, null);
  } finally {
    first.kill();
  }
});
