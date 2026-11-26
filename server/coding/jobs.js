import { randomUUID } from "node:crypto";
import { defaultRoot, RESTRICTED_WORKSPACE_CONSENT, createHierarchicalProject, resumeProject } from "./generator/engine.mjs";
import { requestCoordinator } from "./generator/client.mjs";
import { readProjectSummary } from "./projectFiles.js";

// Runs the existing generator engine inside the backend. It adds no process
// spawning and never executes generated code. A job is single-flight: the
// engine's project lock and the shared inference queue still apply.
const MAX_EVENTS = 400;
const CONSENT_VALUE = RESTRICTED_WORKSPACE_CONSENT;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function coordinatorToken() {
  const token = process.env.AI_COORDINATOR_TOKEN;
  return typeof token === "string" && token.length >= 32 ? token : null;
}

export function createJobManager({
  root = defaultRoot,
  engine = { createHierarchicalProject, resumeProject },
  createProvider = () => {
    const token = coordinatorToken();
    return (messages, signal, options) => requestCoordinator(messages, token, signal, options);
  },
  tokenAvailable = () => Boolean(coordinatorToken())
} = {}) {
  const jobs = new Map();
  let runningId = null;

  function log(job, message) {
    if (typeof message !== "string" || !message) return;
    job.events.push({ at: new Date().toISOString(), message: message.slice(0, 300) });
    if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
  }

  async function snapshot(job) {
    const project = job.projectId
      ? await readProjectSummary(root, job.projectId).catch(() => null)
      : null;
    return {
      id: job.id,
      status: job.status,
      request: job.request,
      projectId: job.projectId,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      events: job.events.slice(-100),
      project
    };
  }

  function findJob(id) {
    const job = jobs.get(id);
    if (!job) throw httpError(404, "Generation job not found.");
    return job;
  }

  function start({ request, acceptTrustedWorkspaceRisk } = {}) {
    if (acceptTrustedWorkspaceRisk !== true) {
      throw httpError(400, "Explicit per-invocation consent for the restricted single-user workspace is required.");
    }
    if (typeof request !== "string" || !request.trim() || request.length > 1500) {
      throw httpError(400, "Provide a project request of 1-1500 characters.");
    }
    if (!tokenAvailable()) {
      throw httpError(503, "Set AI_COORDINATOR_TOKEN (at least 32 characters) in the backend environment before starting generation from the web interface.");
    }
    if (runningId) {
      const running = jobs.get(runningId);
      if (running && running.status === "running") {
        throw httpError(409, "A generation job is already running. Wait for it to finish.");
      }
      runningId = null;
    }

    const job = {
      id: randomUUID(),
      status: "running",
      request: request.trim(),
      projectId: null,
      createdAt: new Date().toISOString(),
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      events: [],
      controller: new AbortController()
    };
    jobs.set(job.id, job);
    runningId = job.id;
    log(job, "Accepted per-invocation restricted workspace consent.");

    (async () => {
      try {
        const provider = createProvider();
        const created = await engine.createHierarchicalProject(root, job.request, provider, job.controller.signal, {
          restrictedWorkspaceConsent: CONSENT_VALUE,
          onProjectCreated: ({ id }) => {
            job.projectId = id;
            log(job, "Project created: " + id);
          },
          onEvent: message => log(job, message)
        });
        job.projectId = created.id;
        await engine.resumeProject(root, created.id, provider, job.controller.signal, message => log(job, message), {
          restrictedWorkspaceConsent: CONSENT_VALUE
        });
        job.status = "completed";
        log(job, "Source generation finished. Generated code has not been executed or functionally tested.");
      } catch (error) {
        job.status = job.controller.signal.aborted ? "cancelled" : "failed";
        job.error = String(error?.message || error).slice(0, 500);
        log(job, "Generation stopped: " + job.error);
      } finally {
        job.finishedAt = Date.now();
        job.controller = null;
        if (runningId === job.id) runningId = null;
      }
    })();

    return snapshot(job);
  }

  async function get(id) {
    return await snapshot(findJob(id));
  }

  function list() {
    return [...jobs.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 20)
      .map(job => ({
        id: job.id,
        status: job.status,
        request: job.request.slice(0, 160),
        projectId: job.projectId,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        error: job.error
      }));
  }

  function cancel(id) {
    const job = findJob(id);
    if (job.status !== "running" || !job.controller) throw httpError(409, "This job is not running.");
    job.controller.abort(new Error("Cancelled from the web interface."));
    job.status = "cancelling";
    log(job, "Cancellation requested. The provider still drains safely; review the checkpoint before resuming.");
    return { id: job.id, status: job.status };
  }

  return { start, get, list, cancel };
}
