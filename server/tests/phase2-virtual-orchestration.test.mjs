import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHierarchicalProject, resumeProject, RESTRICTED_WORKSPACE_CONSENT } from "../coding/generator/engine.mjs";

function virtualFilesystem(root) {
  const entries = new Map([[path.dirname(root), { kind: "dir" }]]);
  const calls = ["lstat", "mkdir", "realpath", "readdir", "open", "rename", "readFile"];
  const original = Object.fromEntries(calls.map(name => [name, fs[name]]));
  const key = value => path.resolve(String(value));
  const fail = code => Object.assign(new Error(code), { code });
  const stat = entry => ({
    isDirectory: () => entry.kind === "dir",
    isFile: () => entry.kind === "file",
    isSymbolicLink: () => false,
    size: entry.kind === "file" ? Buffer.byteLength(entry.content) : 0
  });
  fs.lstat = async value => {
    const entry = entries.get(key(value));
    if (!entry) throw fail("ENOENT");
    return stat(entry);
  };
  fs.mkdir = async value => {
    const name = key(value);
    if (entries.has(name)) throw fail("EEXIST");
    if (!entries.has(path.dirname(name))) throw fail("ENOENT");
    entries.set(name, { kind: "dir" });
  };
  fs.realpath = async value => {
    const name = key(value);
    if (!entries.has(name)) throw fail("ENOENT");
    return name;
  };
  fs.readdir = async (value, options = {}) => {
    const dir = key(value);
    if (!entries.has(dir)) throw fail("ENOENT");
    const children = [...entries].filter(([name]) => name !== dir && path.dirname(name) === dir);
    return children.map(([name, entry]) => options.withFileTypes ?
      { name: path.basename(name), ...stat(entry) } : path.basename(name));
  };
  fs.open = async (value, flags) => {
    const name = key(value);
    if (flags !== "wx") throw new Error("Unexpected virtual open.");
    if (entries.has(name)) throw fail("EEXIST");
    if (!entries.has(path.dirname(name))) throw fail("ENOENT");
    const entry = { kind: "file", content: "" };
    entries.set(name, entry);
    return { writeFile: async content => { entry.content = String(content); }, sync: async () => {}, close: async () => {} };
  };
  fs.rename = async (from, to) => {
    const source = key(from), destination = key(to), entry = entries.get(source);
    if (!entry) throw fail("ENOENT");
    entries.set(destination, entry); entries.delete(source);
  };
  fs.readFile = async value => {
    const entry = entries.get(key(value));
    if (!entry) throw fail("ENOENT");
    return entry.content;
  };
  return { entries, restore: () => { for (const name of calls) fs[name] = original[name]; } };
}

function master() {
  return { schemaVersion: 2, name: "Virtual project", objective: "Plan 60 data source files",
    requirements: ["Create 60 files"], architecture: "Six modules with sequential dependencies",
    stack: { languages: ["JSON"], frameworks: [], dependencies: [] }, contracts: [],
    modules: Array.from({ length: 6 }, (_, i) => ({ id: "m" + i, objective: "Module " + i, dependsOn: i ? ["m" + (i - 1)] : [], contractRefs: [] })),
    acceptanceCriteria: ["Plan all files"] };
}
function modulePlan(i) {
  const tasks = Array.from({ length: 10 }, (_, n) => ({ id: "m" + i + "--t" + n, title: "Task " + n, description: "Create JSON source",
    targetPath: "module" + i + "/file" + n + ".json", operation: "create",
    dependsOn: n ? ["m" + i + "--t" + (n - 1)] : i ? ["m" + (i - 1) + "--t9"] : [],
    contextRefs: [], contractRefs: [], acceptanceCriteria: ["Valid JSON"], validation: "json" }));
  return { schemaVersion: 2, moduleId: "m" + i, objective: "Module " + i, contractRefs: [], completionCriteria: ["Done"],
    batches: [{ id: "first", tasks: tasks.slice(0, 5) }, { id: "second", tasks: tasks.slice(5) }] };
}
const result = value => ({ doneReason: "stop", content: JSON.stringify(value) });

test("60-file hierarchical engine orchestration uses only an in-memory filesystem", { timeout: 20000 }, async () => {
  const root = path.resolve("virtual-test-workspace", "projects"), virtual = virtualFilesystem(root);
  let calls = 0;
  const provider = async messages => {
    calls++;
    const instructions = messages[0].content;
    if (instructions.includes("master plan schemaVersion 2")) return result(master());
    if (instructions.includes("module plan schemaVersion 2")) {
      const moduleId = JSON.parse(messages[1].content).module.id;
      return result(modulePlan(Number(moduleId.slice(1))));
    }
    return result({ code: '{"value":42}' });
  };
  const consent = { restrictedWorkspaceConsent: RESTRICTED_WORKSPACE_CONSENT, onEvent: () => {} };
  try {
    const project = await createHierarchicalProject(root, "Plan 60 files", provider, new AbortController().signal, consent);
    const completed = await resumeProject(root, project.id, provider, new AbortController().signal, () => {}, consent);
    assert.equal(completed.schemaVersion, 2);
    assert.equal(completed.status, "generated");
    assert.equal(completed.modulePlans.length, 6);
    assert.equal(completed.tasks.length, 60);
    assert.ok(completed.tasks.every(task => task.status === "generated" && task.validationResult === "json syntax passed"));
    assert.equal(calls, 67);
    await resumeProject(root, project.id, provider, new AbortController().signal, () => {}, consent);
    assert.equal(calls, 67);
    assert.equal([...virtual.entries.values()].filter(entry => entry.kind === "file" && entry.content === '{"value":42}').length, 60);
  } finally { virtual.restore(); }
});

test("partial module planning resumes without replanning completed modules", { timeout: 20000 }, async () => {
  const root = path.resolve("virtual-test-recovery", "projects"), virtual = virtualFilesystem(root);
  const planned = [];
  let failModule = true, projectId;
  const provider = async messages => {
    const instructions = messages[0].content;
    if (instructions.includes("master plan schemaVersion 2")) return result(master());
    if (instructions.includes("module plan schemaVersion 2")) {
      const moduleId = JSON.parse(messages[1].content).module.id;
      planned.push(moduleId);
      if (failModule && moduleId === "m2") return { doneReason: "length", content: "{}" };
      return result(modulePlan(Number(moduleId.slice(1))));
    }
    return result({ code: '{"value":42}' });
  };
  const consent = { restrictedWorkspaceConsent: RESTRICTED_WORKSPACE_CONSENT, onEvent: () => {},
    onProjectCreated: ({ id }) => { projectId = id; } };
  try {
    await assert.rejects(createHierarchicalProject(root, "Plan 60 files", provider, new AbortController().signal, consent), /Incomplete/);
    assert.ok(projectId);
    assert.deepEqual(planned, ["m0", "m1", "m2", "m2"]);
    failModule = false; planned.length = 0;
    await assert.rejects(resumeProject(root, projectId, provider, new AbortController().signal, () => {},
      { ...consent, expectedTargets: ["other.json"] }), /Planned targets do not match/);
    assert.deepEqual(planned, []);
    const expectedTargets = Array.from({ length: 6 }, (_, i) => modulePlan(i).batches.flatMap(batch => batch.tasks.map(task => task.targetPath))).flat();
    const completed = await resumeProject(root, projectId, provider, new AbortController().signal, () => {}, { ...consent, expectedTargets });
    assert.equal(completed.tasks.length, 60);
    assert.equal(completed.status, "generated");
    assert.deepEqual(planned, ["m2", "m3", "m4", "m5"]);
    const file = path.resolve(root, projectId, "module0", "file0.json");
    virtual.entries.get(file).content = '{"edited":true}';
    await assert.rejects(resumeProject(root, projectId, provider, new AbortController().signal, () => {}, consent), /modified/);
    assert.equal(virtual.entries.get(file).content, '{"edited":true}');
  } finally { virtual.restore(); }
});


test("actual 60-file hierarchical filesystem recovery", {
  timeout: 120000,
  skip: !process.env.AI_PHASE2_TEST_ROOT
}, async () => {
  const realFs = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");

  const root = path.resolve(process.env.AI_PHASE2_TEST_ROOT);

  const rootInfo = await realFs.lstat(root);

  assert.ok(rootInfo.isDirectory());
  assert.equal(rootInfo.isSymbolicLink(), false);
  assert.deepEqual(await realFs.readdir(root), []);

  const planned = [];

  let projectId;
  let masterCalls = 0;
  let generationCalls = 0;
  let failModule = true;

  const provider = async messages => {
    const instructions = messages[0].content;

    if (instructions.includes("master plan schemaVersion 2")) {
      masterCalls++;
      return result(master());
    }

    if (instructions.includes("module plan schemaVersion 2")) {
      const moduleId = JSON.parse(messages[1].content).module.id;

      planned.push(moduleId);

      if (failModule && moduleId === "m2") {
        return {
          doneReason: "length",
          content: "{}"
        };
      }

      return result(modulePlan(Number(moduleId.slice(1))));
    }

    generationCalls++;

    return result({
      code: '{"value":42}'
    });
  };

  const consent = {
    restrictedWorkspaceConsent: RESTRICTED_WORKSPACE_CONSENT,
    onEvent: () => {},
    onProjectCreated: ({ id }) => {
      projectId = id;
    }
  };

  console.log("Testing interrupted hierarchical planning...");

  await assert.rejects(
    createHierarchicalProject(
      root,
      "Create a 60-file modular project",
      provider,
      new AbortController().signal,
      consent
    ),
    /Incomplete/
  );

  assert.ok(projectId);
  assert.equal(masterCalls, 1);

  assert.deepEqual(
    planned,
    ["m0", "m1", "m2", "m2"]
  );

  failModule = false;
  planned.length = 0;

  console.log("Resuming persisted project planning...");

  const completed = await resumeProject(
    root,
    projectId,
    provider,
    new AbortController().signal,
    () => {},
    consent
  );

  assert.equal(completed.schemaVersion, 2);
  assert.equal(completed.status, "generated");
  assert.equal(completed.modulePlans.length, 6);
  assert.equal(completed.tasks.length, 60);

  assert.deepEqual(
    planned,
    ["m2", "m3", "m4", "m5"]
  );

  assert.equal(masterCalls, 1);
  assert.equal(generationCalls, 60);

  const projectDir = path.join(root, projectId);

  const definitions = completed.modulePlans.flatMap(
    module => module.batches.flatMap(batch => batch.tasks)
  );

  assert.equal(definitions.length, 60);

  assert.equal(
    new Set(definitions.map(def => def.targetPath)).size,
    60
  );

  let verifiedFiles = 0;

  for (const def of definitions) {
    const task = completed.tasks.find(
      item => item.id === def.id
    );

    assert.ok(task);
    assert.equal(task.status, "generated");

    const filePath = path.join(
      projectDir,
      def.targetPath
    );

    const source = await realFs.readFile(
      filePath,
      "utf8"
    );

    assert.deepEqual(
      JSON.parse(source),
      { value: 42 }
    );

    const hash = createHash("sha256")
      .update(source)
      .digest("hex");

    assert.equal(hash, task.outputHash);

    verifiedFiles++;
  }

  const checkpoint = JSON.parse(
    await realFs.readFile(
      path.join(projectDir, "build-progress.json"),
      "utf8"
    )
  );

  assert.equal(checkpoint.schemaVersion, 2);
  assert.equal(checkpoint.status, "generated");
  assert.equal(checkpoint.tasks.length, 60);

  console.log("Verified actual files:", verifiedFiles);

  await resumeProject(
    root,
    projectId,
    async () => {
      throw new Error(
        "Completed project must not regenerate."
      );
    },
    new AbortController().signal,
    () => {},
    consent
  );

  assert.equal(generationCalls, 60);

  console.log("Resume without regeneration: PASS");
  console.log("Actual file hash verification: PASS");
  console.log("Project location:", projectDir);
});
