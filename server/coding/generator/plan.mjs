import path from "node:path";

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const string = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

// Strengthen a valid "none" choice using deterministic knowledge of the suffix.
export function selectRequiredValidators(plan) {
  if (Array.isArray(plan?.tasks)) {
    for (const task of plan.tasks) {
      if (typeof task?.targetPath !== "string" || task.validation !== "none") continue;
      if (/\.(js|mjs|cjs)$/i.test(task.targetPath)) task.validation = "javascript";
      else if (/\.json$/i.test(task.targetPath)) task.validation = "json";
    }
  }
  return plan;
}

export function validateTarget(value) {
  if (typeof value !== "string" || !value || value.length > 240 || path.win32.isAbsolute(value) || path.posix.isAbsolute(value) || value.includes("\\")) throw new Error("Unsafe target path.");
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.length > 100 || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || reserved.test(part))) throw new Error("Unsafe target path.");
  const first = parts[0].toLowerCase();
  if (["build-progress.json", ".project-plan.json", "master-plan.json", "module-plan.json", ".ai-assistant"].includes(first) ||
      /^\.checkpoint-.*\.tmp$/i.test(first)) throw new Error("Reserved target path.");
  return value;
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || plan.schemaVersion !== 1) throw new Error("Invalid plan schema version.");
  if (!string(plan.name, 100) || !string(plan.objective, 1500) || !string(plan.language, 120) || typeof plan.framework !== "string" || plan.framework.length > 120 ||
      !Array.isArray(plan.requirements) || plan.requirements.length < 1 || plan.requirements.length > 30 || plan.requirements.some(s => !string(s, 500)) ||
      !Array.isArray(plan.dependencies) || plan.dependencies.length > 30 || plan.dependencies.some(s => !string(s, 200)) ||
      !Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > 40) throw new Error("Invalid project plan fields or size.");
  const ids = new Set(), targets = new Set();
  for (const task of plan.tasks) {
    if (!task || typeof task.id !== "string" || !idPattern.test(task.id) || ids.has(task.id)) throw new Error("Invalid or duplicate task ID.");
    ids.add(task.id);
    if (!string(task.title, 150) || !string(task.description, 1500) || task.operation !== "create" ||
        !Array.isArray(task.dependsOn) || task.dependsOn.length > 40 || task.dependsOn.some(v => typeof v !== "string" || !idPattern.test(v)) ||
        new Set(task.dependsOn).size !== task.dependsOn.length ||
        !Array.isArray(task.contextRefs) || task.contextRefs.length > 40 || task.contextRefs.some(v => typeof v !== "string" || !idPattern.test(v)) ||
        !Array.isArray(task.acceptanceCriteria) || !task.acceptanceCriteria.length || task.acceptanceCriteria.length > 20 || task.acceptanceCriteria.some(v => !string(v, 500)) ||
        !["javascript", "json", "none"].includes(task.validation) ||
        (task.status !== undefined && task.status !== "pending")) throw new Error("Invalid task fields.");
    const target = validateTarget(task.targetPath).toLowerCase();
    if (/\.(js|mjs|cjs)$/.test(target) && task.validation !== "javascript") throw new Error("JavaScript syntax validation is required.");
    if (/\.json$/.test(target) && task.validation !== "json") throw new Error("JSON validation is required.");
    if (targets.has(target)) throw new Error("Case-insensitive target collision.");
    targets.add(target);
  }
  for (const target of targets) {
    const parts = target.split("/");
    for (let i = 1; i < parts.length; i++) if (targets.has(parts.slice(0, i).join("/"))) throw new Error("File and directory target collision.");
  }
  for (const task of plan.tasks) {
    if (task.dependsOn.some(id => !ids.has(id)) || task.contextRefs.some(id => !task.dependsOn.includes(id))) throw new Error("Missing dependency or invalid context reference.");
  }
  orderTasks(plan.tasks);
  return plan;
}

export function orderTasks(tasks) {
  const done = new Set(), ordered = [];
  while (ordered.length < tasks.length) {
    const next = tasks.find(t => !done.has(t.id) && t.dependsOn.every(id => done.has(id)));
    if (!next) throw new Error("Circular or missing task dependencies.");
    ordered.push(next);
    done.add(next.id);
  }
  return ordered;
}
