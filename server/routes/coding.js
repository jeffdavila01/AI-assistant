import express from "express";
import { getQueueStatus } from "../ai/requestQueue.js";
import { createJobManager } from "../coding/jobs.js";
import { defaultRoot } from "../coding/generator/engine.mjs";
import {
  listProjects,
  readProjectSummary,
  listDirectory,
  readProjectFile
} from "../coding/projectFiles.js";

// Local coding console. Read-only project views plus consent-gated generation
// through the existing engine. No endpoint runs generated code or shell commands.
export function createCodingRouter({ root = defaultRoot, jobs = createJobManager({ root }) } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const fail = (res, error) => {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (status >= 500) console.error("[coding-console]", error?.message || "internal error");
    res.status(status).json({ error: status >= 500 ? "Coding workspace request failed." : error.message });
  };

  router.get("/status", (req, res) => {
    res.json({
      projectsRoot: root,
      consentRequired: true,
      coordinatorConfigured: typeof process.env.AI_COORDINATOR_TOKEN === "string" && process.env.AI_COORDINATOR_TOKEN.length >= 32,
      queue: getQueueStatus()
    });
  });

  router.get("/projects", async (req, res) => {
    try {
      res.json({ projects: await listProjects(root) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get("/projects/:id", async (req, res) => {
    try {
      res.json({ project: await readProjectSummary(root, req.params.id) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get("/projects/:id/files", async (req, res) => {
    try {
      const relativePath = typeof req.query.path === "string" ? req.query.path : "";
      res.json(await listDirectory(root, req.params.id, relativePath));
    } catch (error) {
      fail(res, error);
    }
  });

  router.get("/projects/:id/file", async (req, res) => {
    try {
      if (typeof req.query.path !== "string" || !req.query.path) {
        return res.status(400).json({ error: "A file path is required." });
      }
      res.json(await readProjectFile(root, req.params.id, req.query.path));
    } catch (error) {
      fail(res, error);
    }
  });

  router.post("/generate", async (req, res) => {
    try {
      const body = req.body || {};
      const job = await jobs.start({
        request: body.request,
        acceptTrustedWorkspaceRisk: body.acceptTrustedWorkspaceRisk === true
      });
      res.status(202).json({ job });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get("/jobs", (req, res) => {
    res.json({ jobs: jobs.list() });
  });

  router.get("/jobs/:id", async (req, res) => {
    try {
      res.json({ job: await jobs.get(req.params.id) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.post("/jobs/:id/cancel", (req, res) => {
    try {
      res.json({ job: jobs.cancel(req.params.id) });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
