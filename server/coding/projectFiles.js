import fs from "node:fs/promises";
import path from "node:path";

// Read-only views of generated projects. Nothing here writes, creates or
// executes files; the generator engine remains the only writer.
const projectIdPattern = /^project-[0-9]+-[a-f0-9]{8}$/;
const MAX_FILE_BYTES = 200000;
const MAX_ENTRIES = 500;
const MAX_DEPTH = 12;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validSegment(segment) {
  return typeof segment === "string" && segment.length > 0 && segment.length <= 100 &&
    segment !== "." && segment !== ".." && !/[\\/<>:"|?*\x00-\x1f]/.test(segment) &&
    !/[. ]$/.test(segment) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment);
}

function relativeParts(relativePath) {
  if (relativePath === undefined || relativePath === null || relativePath === "") return [];
  if (typeof relativePath !== "string" || relativePath.length > 400) throw httpError(400, "Invalid file path.");
  if (path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath) || relativePath.includes("\\")) {
    throw httpError(400, "Invalid file path.");
  }
  const raw = relativePath.split("/");
  if (raw.length > MAX_DEPTH) throw httpError(400, "File path is too deep.");
  for (const segment of raw) {
    if (!validSegment(segment)) throw httpError(400, "Invalid file path.");
  }
  return raw;
}

async function plainDirectory(target) {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw httpError(400, "Workspace path is not a plain directory.");
  return stat;
}

async function plainFile(target) {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw httpError(400, "Target is not a plain file.");
  return stat;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function validateProjectId(id) {
  if (typeof id !== "string" || !projectIdPattern.test(id)) throw httpError(400, "Invalid project ID.");
  return id;
}

export async function resolveProjectsRoot(root) {
  if (typeof root !== "string" || !path.isAbsolute(root)) throw httpError(500, "AI_PROJECTS_ROOT must be an absolute path.");
  try {
    await plainDirectory(root);
  } catch (error) {
    if (error.code === "ENOENT") throw httpError(404, "The projects directory does not exist yet.");
    throw error;
  }
  return await fs.realpath(root);
}

export async function resolveProjectDirectory(root, id) {
  validateProjectId(id);
  const realRoot = await resolveProjectsRoot(root);
  const dir = path.join(realRoot, id);
  let realDir;
  try {
    realDir = await fs.realpath(dir);
  } catch (error) {
    if (error.code === "ENOENT") throw httpError(404, "Project not found.");
    throw error;
  }
  await plainDirectory(dir);
  if (!isInside(realRoot, realDir)) throw httpError(400, "Project escapes the workspace.");
  const stat = await fs.lstat(realDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw httpError(400, "Project is not a plain directory.");
  return { dir: realDir, realRoot };
}

// Checkpoints are untrusted input for display purposes: never promote, trust
// or act on their contents, and never let a malformed file break the console.
export async function readCheckpoint(dir) {
  const target = path.join(dir, "build-progress.json");
  let stat;
  try {
    stat = await plainFile(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (stat.size > 2000000) return null;
  try {
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch {
    return null;
  }
}

function taskDefinitions(state) {
  if (!state || typeof state !== "object") return [];
  if (state.schemaVersion === 1) {
    return Array.isArray(state.plan?.tasks) ? state.plan.tasks : [];
  }
  if (!Array.isArray(state.modulePlans)) return [];
  const definitions = [];
  for (const plan of state.modulePlans) {
    if (!plan || !Array.isArray(plan.batches)) continue;
    for (const batch of plan.batches) {
      if (!batch || !Array.isArray(batch.tasks)) continue;
      definitions.push(...batch.tasks);
    }
  }
  return definitions;
}

const allowedStates = new Set(["pending", "queued", "generating", "validating", "saving", "generated", "failed", "interrupted", "blocked", "cancelled"]);

export function summarizeProject(id, state) {
  const definitions = taskDefinitions(state);
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const byId = new Map();
  for (const task of tasks) {
    if (task && typeof task.id === "string") byId.set(task.id, task);
  }
  const counts = { total: 0, generated: 0, failed: 0, blocked: 0, pending: 0, interrupted: 0 };
  const targets = [];
  for (const definition of definitions) {
    if (!definition || typeof definition.targetPath !== "string") continue;
    const task = byId.get(definition.id) || {};
    const status = allowedStates.has(task.status) ? task.status : "pending";
    counts.total += 1;
    if (status === "generated") counts.generated += 1;
    else if (status === "failed") counts.failed += 1;
    else if (status === "blocked") counts.blocked += 1;
    else if (status === "interrupted") counts.interrupted += 1;
    else counts.pending += 1;
    if (targets.length < MAX_ENTRIES) {
      targets.push({
        id: typeof definition.id === "string" ? definition.id : null,
        path: definition.targetPath.slice(0, 240),
        status,
        attempts: Number.isInteger(task.attempts) ? task.attempts : 0,
        validation: typeof task.validationResult === "string" ? task.validationResult.slice(0, 120) : null,
        error: typeof task.lastError === "string" ? task.lastError.slice(0, 300) : null
      });
    }
  }
  const updatedAt = Number.isFinite(Date.parse(state?.updatedAt)) ? state.updatedAt : null;
  return {
    id,
    status: typeof state?.status === "string" ? state.status.slice(0, 40) : "unknown",
    requestPreview: typeof state?.request === "string" ? state.request.slice(0, 240) : "",
    createdAt: Number.isFinite(Date.parse(state?.createdAt)) ? state.createdAt : null,
    updatedAt,
    planning: state?.status === "planning",
    moduleCount: Array.isArray(state?.modulePlans) ? state.modulePlans.length : 0,
    counts,
    targets
  };
}

export async function readProjectSummary(root, id) {
  const { dir } = await resolveProjectDirectory(root, id);
  const state = await readCheckpoint(dir);
  if (!state) {
    return { id, status: "unknown", requestPreview: "", createdAt: null, updatedAt: null, planning: false,
      moduleCount: 0, counts: { total: 0, generated: 0, failed: 0, blocked: 0, pending: 0, interrupted: 0 },
      targets: [], checkpoint: "unavailable" };
  }
  if (state.projectId !== undefined && state.projectId !== id) throw httpError(400, "Checkpoint does not match this project.");
  return { ...summarizeProject(id, state), checkpoint: "available" };
}

export async function listProjects(root) {
  let realRoot;
  try {
    realRoot = await resolveProjectsRoot(root);
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
  const entries = await fs.readdir(realRoot, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !projectIdPattern.test(entry.name)) continue;
    if (projects.length >= 100) break;
    try {
      projects.push(await readProjectSummary(realRoot, entry.name));
    } catch {
      // Skip unsafe or unreadable project directories instead of failing the list.
    }
  }
  return projects.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

async function resolveInside(dir, parts) {
  let current = dir;
  for (const segment of parts) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") throw httpError(404, "File not found.");
      throw error;
    }
    if (stat.isSymbolicLink()) throw httpError(400, "Symlinks and junctions are not displayed.");
    const resolved = await fs.realpath(current);
    if (!isInside(dir, resolved)) throw httpError(400, "Path escapes the project.");
  }
  return current;
}

export async function listDirectory(root, id, relativePath) {
  const parts = relativeParts(relativePath);
  const { dir } = await resolveProjectDirectory(root, id);
  const target = parts.length ? await resolveInside(dir, parts) : dir;
  await plainDirectory(target);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (result.length >= MAX_ENTRIES) break;
    if (/^\.checkpoint-[a-f0-9-]{36}\.tmp$/i.test(entry.name)) continue;
    if (entry.isSymbolicLink() || entry.isFIFO?.() || entry.isSocket?.()) continue;
    const type = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : null;
    if (!type) continue;
    let size = null;
    if (type === "file") {
      try {
        const stat = await fs.lstat(path.join(target, entry.name));
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        size = stat.size;
      } catch {
        continue;
      }
    }
    result.push({ name: entry.name, type, size });
  }
  result.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
  return { path: parts.join("/"), entries: result, truncated: entries.length > result.length };
}

export async function readProjectFile(root, id, relativePath) {
  const parts = relativeParts(relativePath);
  if (!parts.length) throw httpError(400, "A file path is required.");
  const { dir } = await resolveProjectDirectory(root, id);
  const target = await resolveInside(dir, parts);
  const stat = await plainFile(target);
  if (stat.size > MAX_FILE_BYTES) throw httpError(413, "File is too large to display (limit 200 KB).");
  const content = await fs.readFile(target, "utf8");
  return {
    path: parts.join("/"),
    size: stat.size,
    content,
    binary: content.includes("\x00"),
    truncated: false
  };
}
