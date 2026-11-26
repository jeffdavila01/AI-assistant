import { validateTarget, selectRequiredValidators } from "./plan.mjs";

const idRe = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const text = (v, max = 1000) => typeof v === "string" && !!v.trim() && v.length <= max;
const texts = (v, min, max, size = 500) => Array.isArray(v) && v.length >= min && v.length <= max && v.every(x => text(x, size));
const ids = (v, max = 40) => Array.isArray(v) && v.length <= max && v.every(x => typeof x === "string" && idRe.test(x)) && new Set(v).size === v.length;

function boundedJson(value, max = 1000000) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > max) throw new Error("Project plan exceeds its size limit.");
}
export function assertExpectedTargets(tasks, expectedTargets, complete = false) {
  if (!expectedTargets) return;
  const expected = new Set(expectedTargets);
  if (tasks.some(task => !expected.has(task.targetPath)) ||
      (complete && (tasks.length !== expected.size || tasks.some(task => !expected.has(task.targetPath))))) {
    throw new Error("Planned targets do not match the explicitly required targets; source generation stopped for review.");
  }
}
function order(items, getId, getDeps) {
  const seen = new Set(), result = [];
  while (result.length < items.length) {
    const next = items.find(item => !seen.has(getId(item)) && getDeps(item).every(d => seen.has(d)));
    if (!next) throw new Error("Circular or missing dependencies.");
    seen.add(getId(next)); result.push(next);
  }
  return result;
}

export function validateMaster(master) {
  if (!master || master.schemaVersion !== 2 || !text(master.name, 100) || !text(master.objective, 1500) ||
      !texts(master.requirements, 1, 30) || !text(master.architecture, 2000) ||
      !master.stack || !texts(master.stack.languages, 1, 10, 100) ||
      !texts(master.stack.frameworks, 0, 10, 100) || !texts(master.stack.dependencies, 0, 30, 200) ||
      !texts(master.acceptanceCriteria, 1, 20) || !Array.isArray(master.contracts) || master.contracts.length > 40 ||
      !Array.isArray(master.modules) || master.modules.length < 1 || master.modules.length > 20) throw new Error("Invalid master plan.");
  const contractIds = new Set();
  for (const contract of master.contracts) {
    if (!contract || typeof contract.id !== "string" || !idRe.test(contract.id) || contractIds.has(contract.id) || !text(contract.description, 1000)) throw new Error("Invalid or duplicate contract.");
    contractIds.add(contract.id);
  }
  const moduleIds = new Set();
  for (const module of master.modules) {
    if (!module || typeof module.id !== "string" || !idRe.test(module.id) || moduleIds.has(module.id) ||
        !text(module.objective, 1000) || !ids(module.dependsOn, 20) || !ids(module.contractRefs, 40) ||
        module.contractRefs.some(id => !contractIds.has(id))) throw new Error("Invalid module definition or contract reference.");
    moduleIds.add(module.id);
  }
  for (const module of master.modules) if (module.dependsOn.some(id => !moduleIds.has(id))) throw new Error("Missing module dependency.");
  order(master.modules, m => m.id, m => m.dependsOn);
  boundedJson(master, 100000);
  return master;
}

function ancestors(master, moduleId, found = new Set()) {
  const module = master.modules.find(m => m.id === moduleId);
  for (const id of module.dependsOn) if (!found.has(id)) { found.add(id); ancestors(master, id, found); }
  return found;
}

export function validateHierarchy(master, modulePlans, { complete = true } = {}) {
  validateMaster(master);
  if (!Array.isArray(modulePlans) || modulePlans.length > master.modules.length) throw new Error("Invalid module plan list.");
  const moduleMap = new Map(), taskMap = new Map(), targets = new Set(), allTasks = [];
  for (const plan of modulePlans) {
    const definition = master.modules.find(m => m.id === plan?.moduleId);
    if (!definition || moduleMap.has(plan.moduleId) || plan.schemaVersion !== 2 || !text(plan.objective, 1000) ||
        !ids(plan.contractRefs, 40) || plan.contractRefs.some(id => !definition.contractRefs.includes(id)) ||
        !texts(plan.completionCriteria, 1, 20) || !Array.isArray(plan.batches) || plan.batches.length < 1 || plan.batches.length > 4) throw new Error("Invalid module plan or contract reference.");
    if (definition.dependsOn.some(id => !moduleMap.has(id))) throw new Error("Module planned before its dependencies.");
    const batchIds = new Set();
    let moduleTaskCount = 0;
    for (const batch of plan.batches) {
      if (!batch || typeof batch.id !== "string" || !idRe.test(batch.id) || batchIds.has(batch.id) ||
          !Array.isArray(batch.tasks) || batch.tasks.length < 1 || batch.tasks.length > 8) throw new Error("Invalid task batch.");
      batchIds.add(batch.id);
      for (const task of batch.tasks) {
        moduleTaskCount++;
        if (!task || typeof task.id !== "string" || !idRe.test(task.id) || !task.id.startsWith(plan.moduleId + "--") || taskMap.has(task.id) ||
            !text(task.title, 150) || !text(task.description, 1500) || task.operation !== "create" ||
            !ids(task.dependsOn, 40) || !ids(task.contextRefs, 40) || task.contextRefs.some(id => !task.dependsOn.includes(id)) ||
            !ids(task.contractRefs, 40) || task.contractRefs.some(id => !plan.contractRefs.includes(id)) ||
            !texts(task.acceptanceCriteria, 1, 20) || !["javascript", "json", "none"].includes(task.validation) ||
            (task.status !== undefined && task.status !== "pending")) throw new Error("Invalid or duplicate task.");
        const target = validateTarget(task.targetPath).toLowerCase();
        if (targets.has(target)) throw new Error("Case-insensitive target collision.");
        if (/\.(js|mjs|cjs)$/.test(target) && task.validation !== "javascript") throw new Error("JavaScript syntax validation is required.");
        if (/\.json$/.test(target) && task.validation !== "json") throw new Error("JSON validation is required.");
        targets.add(target); taskMap.set(task.id, { task, moduleId: plan.moduleId }); allTasks.push(task);
      }
    }
    if (moduleTaskCount > 12) throw new Error("Module task limit exceeded; split it into smaller modules.");
    moduleMap.set(plan.moduleId, plan);
  }
  for (const target of targets) {
    const parts = target.split("/");
    for (let i = 1; i < parts.length; i++) if (targets.has(parts.slice(0, i).join("/"))) throw new Error("File and directory target collision.");
  }
  for (const { task, moduleId } of taskMap.values()) {
    const allowed = ancestors(master, moduleId);
    for (const dep of task.dependsOn) {
      const predecessor = taskMap.get(dep);
      if (!predecessor) throw new Error("Missing task dependency.");
      if (predecessor.moduleId !== moduleId && !allowed.has(predecessor.moduleId)) throw new Error("Cross-module task dependency is not declared.");
    }
  }
  order(allTasks, t => t.id, t => t.dependsOn);
  if (complete && modulePlans.length !== master.modules.length) throw new Error("Incomplete module plans.");
  boundedJson({ master, modulePlans });
  return { master, modulePlans, taskCount: allTasks.length, orderedTasks: order(allTasks, t => t.id, t => t.dependsOn) };
}

async function structured(provider, messages, signal, validate) {
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    const result = await provider([...messages, ...(failure ? [{ role: "user", content: "Correct this validation error: " + failure }] : [])], signal, { stage: "planning" });
    try {
      if (result.doneReason !== "stop" || typeof result.content !== "string" || result.content.length > 50000) throw new Error("Incomplete or oversized planning response.");
      let value;
      try { value = JSON.parse(result.content); } catch { throw new Error("Malformed planning JSON."); }
      validate(value);
      return value;
    } catch (error) { failure = String(error.message).slice(0, 300); }
  }
  throw new Error(failure || "Planning failed.");
}

// onSnapshot is deliberately injected: this module itself never writes files.
export async function planHierarchically(request, provider, signal, onSnapshot = async () => {}, resume = {}, options = {}) {
  if (!text(request, 1500)) throw new Error("Invalid project request.");
  const expectedTargets = options.expectedTargets;
  const master = resume.master ? validateMaster(resume.master) : await structured(provider, [
    { role: "system", content: 'Return only JSON master plan schemaVersion 2: name, objective, requirements (array), architecture, stack {languages, frameworks, dependencies arrays}, contracts [{id,description}], modules [{id,objective,dependsOn,contractRefs}], acceptanceCriteria. Use at most 20 modules, each small enough for at most 12 files. If expectedTargets is supplied, plan exactly those files. No shell commands.' },
    { role: "user", content: expectedTargets ? JSON.stringify({ request, expectedTargets }) : request }
  ], signal, validateMaster);
  const plans = resume.modulePlans ? [...resume.modulePlans] : [];
  validateHierarchy(master, plans, { complete: false });
  const plannedTasks = () => plans.flatMap(p => p.batches.flatMap(b => b.tasks));
  assertExpectedTargets(plannedTasks(), expectedTargets, plans.length === master.modules.length);
  if (!resume.master) await onSnapshot({ schemaVersion: 2, status: "planning", request, master, modulePlans: [] });
  for (const module of order(master.modules, m => m.id, m => m.dependsOn)) {
    if (plans.some(p => p.moduleId === module.id)) continue;
    const required = ancestors(master, module.id);
    const dependencies = plans.filter(p => required.has(p.moduleId)).flatMap(p => p.batches.flatMap(b => b.tasks.map(t => ({ id: t.id, targetPath: t.targetPath }))));
    const remainingTargets = expectedTargets?.filter(target => !plannedTasks().some(task => task.targetPath === target));
    if (remainingTargets && !remainingTargets.length) throw new Error("Planned targets do not match the explicitly required targets; additional modules require targets.");
    const context = JSON.stringify({ request, requirements: master.requirements, module, contracts: master.contracts.filter(c => module.contractRefs.includes(c.id)), dependencies, ...(remainingTargets ? { remainingTargets } : {}) });
    // Byte count also bounds non-ASCII inputs; this is a size guard, not a tokenizer.
    if (Buffer.byteLength(context, "utf8") > 12000) throw new Error("Module planning context too large; decompose dependencies.");
    const plan = await structured(provider, [
      { role: "system", content: 'Return only JSON module plan schemaVersion 2 with moduleId, objective, contractRefs, completionCriteria, batches [{id,tasks}]. Max 12 tasks, max 8 per batch. Each task has id prefixed moduleId--, title, description, targetPath, operation "create", dependsOn, contextRefs, contractRefs, acceptanceCriteria, validation ("javascript", "json", "none"). Dependencies may reference supplied predecessor task IDs. If remainingTargets is supplied, use only those paths; all must be covered across remaining modules. Use relative paths only.' },
      { role: "user", content: context }
    ], signal, value => {
      if (value?.moduleId !== module.id) throw new Error("Module ID mismatch.");
      for (const batch of value.batches || []) selectRequiredValidators({ tasks: batch.tasks });
      validateHierarchy(master, [...plans, value], { complete: false });
      assertExpectedTargets([...plannedTasks(), ...value.batches.flatMap(b => b.tasks)], expectedTargets, plans.length + 1 === master.modules.length);
    });
    plans.push(plan);
    await onSnapshot({ schemaVersion: 2, status: "planning", request, master, modulePlans: [...plans] });
  }
  const result = validateHierarchy(master, plans);
  await onSnapshot({ schemaVersion: 2, status: "planned", request, master, modulePlans: [...plans] });
  return result;
}
