import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createProject, resumeProject, RESTRICTED_WORKSPACE_CONSENT } from "../coding/generator/engine.mjs";

const childFile = fileURLToPath(new URL("./recovery-child.mjs", import.meta.url));
const consent = { restrictedWorkspaceConsent: RESTRICTED_WORKSPACE_CONSENT };
const plan = { schemaVersion: 1, name: "Crash fixture", objective: "Exercise persistence", requirements: ["Create one file"],
  language: "JavaScript", framework: "", dependencies: [], tasks: [{ id: "first", title: "File", description: "Create file",
    targetPath: "file.js", operation: "create", dependsOn: [], contextRefs: [], acceptanceCriteria: ["Valid source"], validation: "javascript" }] };
const source = "export const value = 42;";
const provider = async () => ({ doneReason: "stop", content: JSON.stringify({ code: source }) });

function reached(child) {
  return new Promise((resolve, reject) => {
    child.on("message", message => message.ready ? resolve(message.ready) : message.error && reject(new Error(message.error)));
    child.on("error", reject);
    child.on("exit", code => reject(new Error("Child exited before barrier: " + code)));
  });
}
function exited(child) { return new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal }))); }

for (const stage of ["before-source", "during-source", "after-source", "before-temp", "during-temp", "before-replace", "after-replace"]) {
  test("process termination at " + stage + " preserves recoverable state", { timeout: 20000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-crash-"));
    const project = await createProject(root, "Create one file", async () => ({ doneReason: "stop", content: JSON.stringify(plan) }), new AbortController().signal, consent);
    const child = fork(childFile, [root, project.id, stage], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
    const finish = exited(child);
    try {
      assert.equal(await reached(child), stage);
      child.kill();
      await finish;
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
    let calls = 0;
    if (stage === "during-source") {
      await assert.rejects(resumeProject(root, project.id, provider, new AbortController().signal, () => {}, consent), /Partial or conflicting/);
      assert.equal(await fs.readFile(path.join(project.dir, "file.js"), "utf8"), source.slice(0, 8));
    } else {
      const state = await resumeProject(root, project.id, async () => { calls++; return provider(); }, new AbortController().signal, () => {}, consent);
      assert.equal(state.status, "generated");
      assert.equal(await fs.readFile(path.join(project.dir, "file.js"), "utf8"), source);
      assert.equal(calls, stage === "before-source" ? 1 : 0);
    }
  });
}
