import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { validatePlan, validateTarget, orderTasks } from "../coding/generator/plan.mjs";
import { createProject as createRestrictedProject, resumeProject as resumeRestrictedProject, replaceCheckpoint, RESTRICTED_WORKSPACE_CONSENT } from "../coding/generator/engine.mjs";

// Test fixtures explicitly model an owner-accepted, controlled disposable workspace.
const createProject = (root, request, provider, signal) => createRestrictedProject(root, request, provider, signal, { restrictedWorkspaceConsent: RESTRICTED_WORKSPACE_CONSENT });
const resumeProject = (root, id, provider, signal, onEvent, options = {}) => resumeRestrictedProject(root, id, provider, signal, onEvent, { ...options, restrictedWorkspaceConsent: RESTRICTED_WORKSPACE_CONSENT });

function plan() {
  return { schemaVersion: 1, name: "Small sample", objective: "Two source files", requirements: ["Produce two files"], language: "JavaScript", framework: "", dependencies: [], tasks: [
    { id: "first", title: "First", description: "Create first file", targetPath: "src/a.js", operation: "create", dependsOn: [], contextRefs: [], acceptanceCriteria: ["Exports a value"], validation: "javascript" },
    { id: "second", title: "Second", description: "Create second file", targetPath: "src/b.js", operation: "create", dependsOn: ["first"], contextRefs: ["first"], acceptanceCriteria: ["Uses first"], validation: "javascript" }
  ] };
}
const result = code => ({ doneReason: "stop", content: JSON.stringify({ code }) });
const root = () => fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-phase2-"));
const silent = () => {};
const sig = () => new AbortController().signal;
const planner = async () => ({ doneReason: "stop", content: JSON.stringify(plan()) });

test("plan validation and deterministic dependency ordering", () => {
  const p = plan();
  p.tasks.reverse();
  assert.deepEqual(orderTasks(validatePlan(p).tasks).map(t => t.id), ["first", "second"]);
  const bad = plan(); bad.tasks[1].id = "first";
  assert.throws(() => validatePlan(bad), /duplicate/i);
  const cyclic = plan(); cyclic.tasks[0].dependsOn = ["second"];
  assert.throws(() => validatePlan(cyclic), /circular/i);
  const missing = plan(); missing.tasks[1].dependsOn = ["missing"]; missing.tasks[1].contextRefs = [];
  assert.throws(() => validatePlan(missing), /dependency/i);
  const collision = plan(); collision.tasks[1].targetPath = "SRC/A.JS";
  assert.throws(() => validatePlan(collision), /collision/i);
  const invalid = plan(); invalid.tasks[0].status = "generated";
  assert.throws(() => validatePlan(invalid), /task fields/i);
  for (const name of ["../x.js", "C:/x.js", "/x.js", "src\\x.js", "src/CON.js", "src/a. "]) assert.throws(() => validateTarget(name));
});

test("dynamic files are created in dependency order with context and preserved on resume", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  const calls = [];
  const provider = async messages => {
    calls.push(messages[1].content);
    return calls.length === 1 ? result("export const a = 1;") : result('import { a } from "./a.js";\nexport const b = a + 1;');
  };
  const state = await resumeProject(dir, project.id, provider, sig(), silent);
  assert.deepEqual(state.tasks.map(t => t.status), ["generated", "generated"]);
  assert.match(calls[1], /export const a = 1/);
  assert.equal(await fs.readFile(path.join(project.dir, "src/a.js"), "utf8"), "export const a = 1;");
  await resumeProject(dir, project.id, async () => { throw new Error("Should not regenerate"); }, sig(), silent);
  assert.equal(calls.length, 2);
});

test("explicit expected targets block unexpected plans before source generation", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  let calls = 0;
  await assert.rejects(resumeProject(dir, project.id, async () => { calls++; return result("unexpected"); }, sig(), silent,
    { expectedTargets: ["src/a.js", "src/other.js"] }), /Planned targets do not match/);
  assert.equal(calls, 0);
  assert.deepEqual(await fs.readdir(project.dir), ["build-progress.json"]);
  await assert.rejects(resumeProject(dir, project.id, async () => result("x"), sig(), silent,
    { expectedTargets: ["src/a.js", "SRC/A.JS"] }), /Duplicate expected targets/);
  const state = await resumeProject(dir, project.id, async () => result("export const a = 1;"), sig(), silent,
    { expectedTargets: ["src/b.js", "src/a.js"] });
  assert.equal(state.status, "generated");
});

test("Python source is parsed as data before saving and invalid syntax is retried", async () => {
  const dir = await root();
  const pyPlan = plan();
  pyPlan.language = "Python";
  pyPlan.tasks = [{ ...pyPlan.tasks[0], targetPath: "file.py", validation: "none" }];
  const project = await createProject(dir, "One Python file", async () => ({ doneReason: "stop", content: JSON.stringify(pyPlan) }), sig());
  let calls = 0;
  const source = 'raise RuntimeError("must never execute during syntax checking")\n';
  const state = await resumeProject(dir, project.id, async () => result(++calls === 1 ? "def bad(:\n  pass\n" : source), sig(), silent);
  assert.equal(calls, 2);
  assert.equal(state.tasks[0].validationResult, "python syntax passed");
  assert.equal(await fs.readFile(path.join(project.dir, "file.py"), "utf8"), source);
});

test("Python planned imports require declared dependencies before source is saved", async () => {
  const dir = await root();
  const pyPlan = plan();
  pyPlan.language = "Python";
  pyPlan.tasks[0] = { ...pyPlan.tasks[0], targetPath: "a.py", validation: "none" };
  pyPlan.tasks[1] = { ...pyPlan.tasks[1], targetPath: "b.py", dependsOn: [], contextRefs: [], validation: "none" };
  const project = await createProject(dir, "Two Python files", async () => ({ doneReason: "stop", content: JSON.stringify(pyPlan) }), sig());
  let calls = 0;
  await assert.rejects(resumeProject(dir, project.id, async () => result(++calls === 1 ? "value = 1\n" : "import a\n"), sig(), silent), /not a declared task dependency/);
  assert.equal(calls, 4);
  assert.equal(await fs.readFile(path.join(project.dir, "a.py"), "utf8"), "value = 1\n");
  await assert.rejects(fs.stat(path.join(project.dir, "b.py")), { code: "ENOENT" });
});

test("malformed and truncated output retries are bounded", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  let calls = 0;
  await assert.rejects(resumeProject(dir, project.id, async () => {
    calls++;
    return calls === 1 ? { doneReason: "length", content: "{}" } : { doneReason: "stop", content: "not JSON" };
  }, sig(), silent), /Malformed code JSON/);
  assert.equal(calls, 3);
  const state = JSON.parse(await fs.readFile(path.join(project.dir, "build-progress.json"), "utf8"));
  assert.equal(state.tasks[0].status, "failed");
  assert.equal(state.tasks[1].status, "pending");
  await assert.rejects(fs.stat(path.join(project.dir, "src/a.js")), { code: "ENOENT" });
});

test("interrupted save reconciles a matching file without regeneration", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  const code = "export const a = 1;";
  await fs.mkdir(path.join(project.dir, "src"));
  await fs.writeFile(path.join(project.dir, "src/a.js"), code);
  const state = JSON.parse(await fs.readFile(path.join(project.dir, "build-progress.json"), "utf8"));
  state.tasks[0].status = "saving";
  state.tasks[0].attempts = 1;
  state.tasks[0].pendingHash = createHash("sha256").update(code).digest("hex");
  await fs.writeFile(path.join(project.dir, "build-progress.json"), JSON.stringify(state));
  let calls = 0;
  const resumed = await resumeProject(dir, project.id, async () => { calls++; return result("export const b = 2;"); }, sig(), silent);
  assert.equal(calls, 1);
  assert.equal(resumed.tasks[0].status, "generated");
  assert.equal(await fs.readFile(path.join(project.dir, "src/a.js"), "utf8"), code);
});

test("unexpected modifications block resume and preserve user edits", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  await resumeProject(dir, project.id, async () => result("export const a = 1;"), sig(), silent);
  const file = path.join(project.dir, "src/a.js");
  await fs.writeFile(file, "user edit");
  await assert.rejects(resumeProject(dir, project.id, async () => result("x"), sig(), silent), /modified/);
  assert.equal(await fs.readFile(file, "utf8"), "user edit");
});

test("malformed and truncated plans are rejected without creating a project", async () => {
  const dir = await root();
  await assert.rejects(createProject(dir, "test", async () => ({ doneReason: "length", content: "{}" }), sig()), /incomplete/);
  await assert.rejects(createProject(dir, "test", async () => ({ doneReason: "stop", content: "{" }), sig()), /malformed/);
  assert.deepEqual(await fs.readdir(dir), []);
});

test("provider timeout is bounded by task retry limit", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  let calls = 0;
  await assert.rejects(resumeProject(dir, project.id, async () => { calls++; throw new Error("Provider timeout"); }, sig(), silent), /timeout/);
  assert.equal(calls, 3);
  const state = JSON.parse(await fs.readFile(path.join(project.dir, "build-progress.json"), "utf8"));
  assert.equal(state.tasks[0].status, "failed");
});

test("context budget rejection stops retries for an unchanged task", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  let calls = 0;
  await assert.rejects(resumeProject(dir, project.id, async () => {
    calls++;
    const error = new Error("split the task"); error.code = "CONTEXT_BUDGET_EXCEEDED"; throw error;
  }, sig(), silent), /split the task/);
  const state = JSON.parse(await fs.readFile(path.join(project.dir, "build-progress.json"), "utf8"));
  assert.equal(calls, 1);
  assert.equal(state.tasks[0].status, "failed");
  assert.equal(state.tasks[0].attempts, 1);
});

test("partial saved file is preserved and blocked", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  await fs.mkdir(path.join(project.dir, "src"));
  const target = path.join(project.dir, "src/a.js");
  await fs.writeFile(target, "partial");
  const state = JSON.parse(await fs.readFile(path.join(project.dir, "build-progress.json"), "utf8"));
  state.tasks[0].status = "saving"; state.tasks[0].attempts = 1;
  state.tasks[0].pendingHash = createHash("sha256").update("complete").digest("hex");
  await fs.writeFile(path.join(project.dir, "build-progress.json"), JSON.stringify(state));
  await assert.rejects(resumeProject(dir, project.id, async () => result("x"), sig(), silent), /Partial or conflicting/);
  assert.equal(await fs.readFile(target, "utf8"), "partial");
});

test("directory junctions cannot be used as project output paths", async t => {
  const dir = await root(), outside = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  try { await fs.symlink(outside, path.join(project.dir, "src"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { t.skip("Cannot create a test junction: " + error.code); return; }
  await assert.rejects(resumeProject(dir, project.id, async () => result("export const a = 1;"), sig(), silent), /Unexpected symlink or junction in project: src|plain directory/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("HTML content outside the closing document is rejected and retried", async () => {
  const dir = await root();
  const p = plan();
  p.tasks = [{ id: "page", title: "Page", description: "Create an HTML page", targetPath: "index.html", operation: "create", dependsOn: [], contextRefs: [], acceptanceCriteria: ["Contains a page"], validation: "none" }];
  const project = await createProject(dir, "Page", async () => ({ doneReason: "stop", content: JSON.stringify(p) }), sig());
  let attempts = 0;
  const state = await resumeProject(dir, project.id, async () => {
    attempts++;
    return result(attempts === 1 ? "<html><body>hello</body></html><script>bad()</script>" : "<html><body>hello</body></html>");
  }, sig(), silent);
  assert.equal(attempts, 2);
  assert.equal(state.tasks[0].validationResult, "basic HTML document structure passed");
  assert.equal(await fs.readFile(path.join(project.dir, "index.html"), "utf8"), "<html><body>hello</body></html>");
});

test("checkpoint replacement retries transient Windows sharing errors", async () => {
  let calls = 0;
  await replaceCheckpoint("from", "to", async () => {
    calls++;
    if (calls < 3) { const error = new Error("locked"); error.code = "EPERM"; throw error; }
  });
  assert.equal(calls, 3);
  await assert.rejects(replaceCheckpoint("from", "to", async () => {
    const error = new Error("invalid"); error.code = "EINVAL"; throw error;
  }), /invalid/);
});

test("interrupted generation resumes from the unfinished task", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  const state = JSON.parse(await fs.readFile(path.join(project.dir, "build-progress.json"), "utf8"));
  state.tasks[0].status = "generating"; state.tasks[0].attempts = 1;
  await fs.writeFile(path.join(project.dir, "build-progress.json"), JSON.stringify(state));
  let calls = 0;
  const completed = await resumeProject(dir, project.id, async () => { calls++; return result("export const a = 1;"); }, sig(), silent);
  assert.equal(calls, 2);
  assert.equal(completed.tasks[0].attempts, 2);
  assert.equal(completed.status, "generated");
});

test("a junction at the workspace parent is rejected", async t => {
  const dir = await root(), outside = await root(), link = path.join(dir, "link");
  try { await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { t.skip("Cannot create a test junction: " + error.code); return; }
  await assert.rejects(createProject(path.join(link, "projects"), "Two files", planner, sig()), /plain directory/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("explicit retry starts a new bounded cycle for a failed task", async () => {
  const dir = await root();
  const project = await createProject(dir, "Two files", planner, sig());
  await assert.rejects(resumeProject(dir, project.id, async () => { throw new Error("mock failure"); }, sig(), silent), /mock failure/);
  await assert.rejects(resumeProject(dir, project.id, async () => result("export const a = 1;"), sig(), silent), /requires review/);
  const state = await resumeProject(dir, project.id, async () => result("export const a = 1;"), sig(), silent, { retryTask: "first" });
  assert.equal(state.status, "generated");
  assert.equal(state.tasks[0].retryHistory.length, 1);
  assert.equal(state.tasks[0].retryHistory[0].attempts, 3);
});
