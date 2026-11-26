import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createCodingRouter } from "../routes/coding.js";
import { createJobManager } from "../coding/jobs.js";
import { readProjectSummary, listDirectory, readProjectFile } from "../coding/projectFiles.js";

const token = "coding-console-test-token-0123456789";

function projectId() {
  return "project-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
}

async function makeProject(root, request = "Build a small inventory app.", tasks = [
  { id: "t1", targetPath: "a.js", status: "generated" },
  { id: "t2", targetPath: "src/b.js", status: "failed" },
  { id: "t3", targetPath: "README.md", status: "pending" }
]) {
  const id = projectId();
  const dir = path.join(root, id);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  const state = {
    schemaVersion: 2,
    projectId: id,
    request,
    status: "generating",
    createdAt: "2026-11-26T00:00:00.000Z",
    updatedAt: "2026-11-26T00:05:00.000Z",
    master: { name: "x" },
    modulePlans: [{
      batches: [{
        tasks: tasks.map(t => ({ id: t.id, targetPath: t.targetPath }))
      }]
    }],
    tasks: tasks.map(t => ({
      id: t.id,
      status: t.status,
      attempts: t.status === "failed" ? 3 : 1,
      outputHash: null,
      lastError: t.status === "failed" ? "Malformed code JSON." : null
    }))
  };
  await fs.writeFile(path.join(dir, "build-progress.json"), JSON.stringify(state, null, 2));
  await fs.writeFile(path.join(dir, "a.js"), "console.log(1);\n");
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "b.js"), "export const b = 1;\n");
  await fs.writeFile(path.join(dir, ".checkpoint-11111111-2222-3333-4444-555555555555.tmp"), "{}");
  return { id, dir };
}

async function withServer(root, jobs, work) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/coding", createCodingRouter({ root, jobs }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/coding`;
  try {
    return await work(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("project summaries are derived from the checkpoint", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-console-"));
  try {
    const { id } = await makeProject(root);
    const summary = await readProjectSummary(root, id);
    assert.equal(summary.counts.total, 3);
    assert.equal(summary.counts.generated, 1);
    assert.equal(summary.counts.failed, 1);
    assert.equal(summary.counts.pending, 1);
    assert.equal(summary.targets.find(t => t.path === "src/b.js").error, "Malformed code JSON.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("file access stays inside the project and hides checkpoint temporaries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-console-"));
  try {
    const { id } = await makeProject(root);
    const listing = await listDirectory(root, id, "");
    const names = listing.entries.map(entry => entry.name);
    assert.ok(names.includes("a.js"));
    assert.ok(names.includes("src"));
    assert.ok(!names.some(name => name.startsWith(".checkpoint-")));

    const nested = await listDirectory(root, id, "src");
    assert.deepEqual(nested.entries.map(entry => entry.name), ["b.js"]);

    const file = await readProjectFile(root, id, "src/b.js");
    assert.equal(file.content, "export const b = 1;\n");

    await assert.rejects(readProjectFile(root, id, "../build-progress.json"), /Invalid file path/);
    await assert.rejects(readProjectFile(root, id, "C:/Windows/win.ini"), /Invalid file path/);
    await assert.rejects(readProjectFile(root, id, "src\\b.js"), /Invalid file path/);
    await assert.rejects(readProjectFile(root, id, "/etc/passwd"), /Invalid file path/);
    await assert.rejects(readProjectFile(root, "project-1-zzzzzzzz", "a.js"), /Invalid project ID/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a symlinked directory inside a project is rejected when the platform permits creating one", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-console-"));
  try {
    const { id, dir } = await makeProject(root);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "coding-outside-"));
    try {
      await fs.writeFile(path.join(outside, "secret.txt"), "secret");
      try {
        await fs.symlink(outside, path.join(dir, "link"), "junction");
      } catch {
        return; // Creating reparse points needs privileges; the check is covered elsewhere.
      }
      await assert.rejects(listDirectory(root, id, "link"), /Symlinks and junctions/);
      await assert.rejects(readProjectFile(root, id, "link/secret.txt"), /Symlinks and junctions/);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("generation requires explicit consent and a configured coordinator token", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-console-"));
  const previous = process.env.AI_COORDINATOR_TOKEN;
  try {
    const manager = createJobManager({ root, engine: { createHierarchicalProject: async () => {}, resumeProject: async () => {} } });

    delete process.env.AI_COORDINATOR_TOKEN;
    assert.throws(() => manager.start({ request: "build something" }),
      error => error.status === 400 && /consent/i.test(error.message));

    await assert.rejects(async () => manager.start({ request: "build something", acceptTrustedWorkspaceRisk: true }),
      error => error.status === 503);

    process.env.AI_COORDINATOR_TOKEN = token;
    await assert.rejects(async () => manager.start({ request: "  ", acceptTrustedWorkspaceRisk: true }),
      error => error.status === 400);
  } finally {
    if (previous === undefined) delete process.env.AI_COORDINATOR_TOKEN;
    else process.env.AI_COORDINATOR_TOKEN = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a web generation job runs the existing engine once and reports progress", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-console-"));
  const previous = process.env.AI_COORDINATOR_TOKEN;
  process.env.AI_COORDINATOR_TOKEN = token;
  try {
    const id = projectId();
    const calls = [];
    const engine = {
      async createHierarchicalProject(rootPath, request, provider, signal, options) {
        calls.push(["create", request]);
        assert.equal(options.restrictedWorkspaceConsent, "single-user-no-untrusted-concurrent-writers");
        const dir = path.join(rootPath, id);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "build-progress.json"), JSON.stringify({
          schemaVersion: 2, projectId: id, request, status: "generating",
          createdAt: "2026-11-26T00:00:00.000Z", updatedAt: "2026-11-26T00:00:01.000Z",
          master: { name: "x" }, modulePlans: [{ batches: [{ tasks: [{ id: "t1", targetPath: "main.js" }] }] }],
          tasks: [{ id: "t1", status: "pending", attempts: 0, outputHash: null }]
        }));
        options.onProjectCreated({ id, dir });
        options.onEvent("Plan saved.");
        return { id, dir };
      },
      async resumeProject(_root, projectIdValue, _provider, signal, onEvent, options) {
        assert.equal(projectIdValue, id);
        assert.equal(options.restrictedWorkspaceConsent, "single-user-no-untrusted-concurrent-writers");
        onEvent("Generating main.js, attempt 1/3");
        await fs.writeFile(path.join(root, id, "main.js"), "export const x = 1;\n");
        const state = JSON.parse(await fs.readFile(path.join(root, id, "build-progress.json"), "utf8"));
        state.status = "generated";
        state.updatedAt = "2026-11-26T00:00:02.000Z";
        state.tasks[0] = { id: "t1", status: "generated", attempts: 1, outputHash: "a".repeat(64) };
        await fs.writeFile(path.join(root, id, "build-progress.json"), JSON.stringify(state));
        onEvent("Saved main.js");
      }
    };
    const manager = createJobManager({ root, engine });
    await withServer(root, manager, async base => {
      const started = await fetch(`${base}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: "Build an inventory app.", acceptTrustedWorkspaceRisk: true })
      });
      assert.equal(started.status, 202);
      const { job } = await started.json();
      assert.equal(job.status, "running");

      const conflict = await fetch(`${base}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: "second", acceptTrustedWorkspaceRisk: true })
      });
      assert.equal(conflict.status, 409);

      let final;
      for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        const response = await fetch(`${base}/jobs/${job.id}`);
        assert.equal(response.status, 200);
        final = (await response.json()).job;
        if (final.status === "completed") break;
      }

      assert.equal(final.status, "completed");
      assert.equal(final.projectId, id);
      assert.equal(final.project.counts.generated, 1);
      assert.ok(final.events.some(event => /Plan saved/.test(event.message)));
      assert.ok(final.events.some(event => /not been executed/.test(event.message)));

      const noConsent = await fetch(`${base}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: "Build an inventory app." })
      });
      assert.equal(noConsent.status, 400);
    });
    assert.deepEqual(calls, [["create", "Build an inventory app."]]);
  } finally {
    if (previous === undefined) delete process.env.AI_COORDINATOR_TOKEN;
    else process.env.AI_COORDINATOR_TOKEN = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cancelling a running job aborts the engine without deleting files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-console-"));
  const previous = process.env.AI_COORDINATOR_TOKEN;
  process.env.AI_COORDINATOR_TOKEN = token;
  try {
    const engine = {
      async createHierarchicalProject() {
        return { id: projectId(), dir: root };
      },
      async resumeProject(_root, _id, _provider, signal) {
        await new Promise((resolve, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    };
    const manager = createJobManager({ root, engine });
    await withServer(root, manager, async base => {
      const started = await fetch(`${base}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: "Build a long project.", acceptTrustedWorkspaceRisk: true })
      });
      const { job } = await started.json();

      const cancelled = await fetch(`${base}/jobs/${job.id}/cancel`, { method: "POST" });
      assert.equal(cancelled.status, 200);

      let final;
      for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        final = (await (await fetch(`${base}/jobs/${job.id}`)).json()).job;
        if (final.status === "cancelled") break;
      }
      assert.equal(final.status, "cancelled");
    });
  } finally {
    if (previous === undefined) delete process.env.AI_COORDINATOR_TOKEN;
    else process.env.AI_COORDINATOR_TOKEN = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("unknown projects and oversized files fail with actionable status codes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-console-"));
  try {
    const manager = createJobManager({ root, engine: { createHierarchicalProject: async () => {}, resumeProject: async () => {} } });
    await withServer(root, manager, async base => {
      const missing = await fetch(`${base}/projects/project-1-abcdef12`);
      assert.equal(missing.status, 404);

      const invalid = await fetch(`${base}/projects/not-a-project`);
      assert.equal(invalid.status, 400);

      const status = await fetch(`${base}/status`);
      const body = await status.json();
      assert.equal(body.consentRequired, true);
      assert.equal(body.projectsRoot, root);
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
