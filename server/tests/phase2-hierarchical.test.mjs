import test from "node:test";
import assert from "node:assert/strict";
import { validateMaster, validateHierarchy, planHierarchically } from "../coding/generator/hierarchical.mjs";
import { validateTarget } from "../coding/generator/plan.mjs";
import { createProject, createHierarchicalProject, resumeProject } from "../coding/generator/engine.mjs";

function master(count = 6) {
  return { schemaVersion: 2, name: "Large mocked project", objective: "Plan a multi-module project",
    requirements: ["Produce source files"], architecture: "Modules with shared interfaces",
    stack: { languages: ["JavaScript"], frameworks: [], dependencies: [] },
    contracts: [{ id: "shared", description: "Shared data interface" }],
    modules: Array.from({ length: count }, (_, i) => ({
      id: "m" + i, objective: "Module " + i, dependsOn: i ? ["m" + (i - 1)] : [], contractRefs: ["shared"]
    })), acceptanceCriteria: ["All modules planned"] };
}
function modulePlan(i, count = 10) {
  const tasks = Array.from({ length: count }, (_, n) => ({
    id: "m" + i + "--t" + n, title: "Task " + n, description: "Create source " + n,
    targetPath: "module" + i + "/file" + n + ".js", operation: "create",
    dependsOn: n ? ["m" + i + "--t" + (n - 1)] : i ? ["m" + (i - 1) + "--t9"] : [],
    contextRefs: [], contractRefs: ["shared"], acceptanceCriteria: ["Create file"], validation: "javascript"
  }));
  return { schemaVersion: 2, moduleId: "m" + i, objective: "Module " + i,
    contractRefs: ["shared"], completionCriteria: ["All tasks generated"],
    batches: [{ id: "batch0", tasks: tasks.slice(0, 5) }, { id: "batch1", tasks: tasks.slice(5) }] };
}
const ok = data => ({ doneReason: "stop", content: JSON.stringify(data) });

test("60-file plan spans validated modules and ordered batches", () => {
  const m = master(), plans = Array.from({ length: 6 }, (_, i) => modulePlan(i));
  const result = validateHierarchy(m, plans);
  assert.equal(result.taskCount, 60);
  assert.equal(result.orderedTasks[0].id, "m0--t0");
  assert.equal(result.orderedTasks.at(-1).id, "m5--t9");
  assert.ok(result.orderedTasks.findIndex(t => t.id === "m0--t9") < result.orderedTasks.findIndex(t => t.id === "m1--t0"));
});

test("duplicate IDs, case collisions, unknown contracts and dependency cycles fail", () => {
  const plans = Array.from({ length: 6 }, (_, i) => modulePlan(i));
  const duplicate = structuredClone(plans); duplicate[0].batches[0].tasks[1].id = "m0--t0";
  assert.throws(() => validateHierarchy(master(), duplicate), /duplicate/i);
  const collision = structuredClone(plans); collision[1].batches[0].tasks[1].targetPath = "MODULE0/FILE0.JS";
  assert.throws(() => validateHierarchy(master(), collision), /collision/i);
  const badContract = master(); badContract.modules[0].contractRefs = ["missing"];
  assert.throws(() => validateMaster(badContract), /contract/i);
  const moduleCycle = master(); moduleCycle.modules[0].dependsOn = ["m5"];
  assert.throws(() => validateMaster(moduleCycle), /circular/i);
  const taskCycle = structuredClone(plans); taskCycle[0].batches[0].tasks[0].dependsOn = ["m0--t1"];
  assert.throws(() => validateHierarchy(master(), taskCycle), /circular/i);
  const undeclared = structuredClone(plans); undeclared[0].batches[0].tasks[0].dependsOn = ["m1--t0"];
  assert.throws(() => validateHierarchy(master(), undeclared), /cross-module/i);
});

test("Windows paths, metadata targets and file-directory collisions are rejected", () => {
  for (const value of ["../file.js", "C:/file.js", "//server/share/file", "C:file.js", "file.js:stream", "con.js", "folder/aux.txt", ".checkpoint-abc.tmp", ".ai-assistant/state.json", "build-progress.json/child"]) {
    assert.throws(() => validateTarget(value), /path|target/i);
  }
  const p = [modulePlan(0)];
  p[0].batches[0].tasks[0].targetPath = "folder";
  p[0].batches[0].tasks[0].validation = "none";
  p[0].batches[0].tasks[1].targetPath = "folder/child.js";
  assert.throws(() => validateHierarchy(master(1), p), /directory target collision/i);
});

test("mocked hierarchical planning emits incremental snapshots without file writes", async () => {
  const plans = Array.from({ length: 6 }, (_, i) => modulePlan(i)), snapshots = [];
  let calls = 0;
  const provider = async () => calls++ === 0 ? ok(master()) : ok(plans[calls - 2]);
  const result = await planHierarchically("Plan a large mocked project", provider, new AbortController().signal, async s => snapshots.push(structuredClone(s)));
  assert.equal(result.taskCount, 60);
  assert.equal(calls, 7);
  assert.deepEqual(snapshots.map(s => s.modulePlans.length), [0, 1, 2, 3, 4, 5, 6, 6]);
  assert.equal(snapshots.at(-1).status, "planned");
});

test("module planning receives the original request and master requirements", async () => {
  const plannedMaster = master(1);
  const request = "Create exactly the required files.";
  let calls = 0;
  await planHierarchically(request, async messages => {
    if (calls++ === 0) return ok(plannedMaster);
    const context = JSON.parse(messages[1].content);
    assert.equal(context.request, request);
    assert.deepEqual(context.requirements, plannedMaster.requirements);
    return ok(modulePlan(0));
  }, new AbortController().signal);
  assert.equal(calls, 2);
});

test("invalid module output is retried once and does not advance snapshots", async () => {
  const snapshots = [];
  let calls = 0;
  const provider = async () => {
    calls++;
    if (calls === 1) return ok(master(1));
    if (calls === 2) return { doneReason: "length", content: "{}" };
    return ok(modulePlan(0));
  };
  const result = await planHierarchically("Plan one module", provider, new AbortController().signal, async s => snapshots.push(structuredClone(s)));
  assert.equal(result.taskCount, 10);
  assert.equal(calls, 3);
  assert.deepEqual(snapshots.map(s => s.modulePlans.length), [0, 1, 1]);
});

test("resuming a partial plan preserves completed modules and requests only the remainder", async () => {
  const m = master(3), existing = [modulePlan(0), modulePlan(1)];
  let calls = 0;
  const result = await planHierarchically("Resume planning", async messages => {
    calls++;
    const dependencies = JSON.parse(messages[1].content).dependencies;
    assert.deepEqual(dependencies[0], { id: "m0--t0", targetPath: "module0/file0.js" });
    assert.equal(dependencies.length, 20);
    return ok(modulePlan(2));
  },
    new AbortController().signal, async () => {}, { master: m, modulePlans: existing });
  assert.equal(result.taskCount, 30);
  assert.equal(calls, 1);
  assert.deepEqual(result.modulePlans.slice(0, 2), existing);
});

test("module context enforces its size limit in UTF-8 without truncation", async () => {
  const m = master(1);
  m.requirements = Array.from({ length: 20 }, () => "界".repeat(300));
  let calls = 0;
  await assert.rejects(planHierarchically("Plan", async () => { calls++; }, new AbortController().signal,
    async () => {}, { master: m, modulePlans: [] }), /context too large/);
  assert.equal(calls, 0);
});

test("exact target guard rejects a resumed partial plan before calling the provider", async () => {
  const existing = [modulePlan(0)];
  let calls = 0;
  await assert.rejects(planHierarchically("Resume", async () => { calls++; }, new AbortController().signal,
    async () => {}, { master: master(2), modulePlans: existing }, { expectedTargets: ["different.js"] }), /Planned targets do not match/);
  assert.equal(calls, 0);
});

test("exact target guard validates each module before snapshot and requires the complete set", async () => {
  const good = modulePlan(0);
  const expectedTargets = good.batches.flatMap(batch => batch.tasks.map(task => task.targetPath));
  const wrong = structuredClone(good); wrong.batches[0].tasks[0].targetPath = "unexpected.js";
  let calls = 0;
  const snapshots = [];
  await planHierarchically("Exact files", async messages => {
    calls++;
    if (calls === 1) {
      assert.deepEqual(JSON.parse(messages[1].content).expectedTargets, expectedTargets);
      return ok(master(1));
    }
    assert.deepEqual(JSON.parse(messages[1].content).remainingTargets, expectedTargets);
    return ok(calls === 2 ? wrong : good);
  }, new AbortController().signal, async snapshot => snapshots.push(structuredClone(snapshot)), {}, { expectedTargets });
  assert.equal(calls, 3);
  assert.deepEqual(snapshots.map(snapshot => snapshot.modulePlans.length), [0, 1, 1]);

  const missing = expectedTargets.concat("missing.js");
  await assert.rejects(planHierarchically("Exact files", async () => ok(good), new AbortController().signal,
    async () => {}, { master: master(1), modulePlans: [] }, { expectedTargets: missing }), /Planned targets do not match/);
});

test("automatic project creation and resume are blocked before provider or filesystem access without consent", async () => {
  let called = false;
  const provider = async () => { called = true; throw new Error("must not run"); };
  const signal = new AbortController().signal;
  await assert.rejects(createProject("unused", "test", provider, signal), /writes are blocked/);
  await assert.rejects(createHierarchicalProject("unused", "test", provider, signal), /writes are blocked/);
  await assert.rejects(resumeProject("unused", "project-1-00000000", provider, signal), /writes are blocked/);
  assert.equal(called, false);
});
