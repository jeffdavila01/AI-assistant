import { useState, useEffect, useCallback } from "react";
import {
  Menu, X, FolderTree, FileCode2, Folder, Play, LoaderCircle,
  CheckCircle2, XCircle, RefreshCw, ChevronRight, AlertTriangle,
  Square, Layers, HardDrive, Clock
} from "lucide-react";

import {
  getCodingStatus,
  getProjects,
  getProject,
  getProjectEntries,
  getProjectFile,
  startGeneration,
  getJob,
  cancelJob
} from "../services/coding";

const runningStatuses = ["running", "cancelling"];

function formatTime(value) {
  if (!value) return "unknown";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "unknown";
  }
}

function statusIcon(status) {
  if (status === "generated") return <CheckCircle2 size={14} />;
  if (["failed", "blocked", "cancelled"].includes(status)) {
    return <XCircle size={14} />;
  }
  if (["generating", "validating", "saving", "queued"].includes(status)) {
    return <LoaderCircle size={14} className="processing-spin" />;
  }

  return <Clock size={14} />;
}

function joinPath(base, name) {
  return base ? `${base}/${name}` : name;
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export default function CodingWorkspace({
  visible,
  onBack,
  onMenu,
  draft,
  onDraftChange
}) {
  const [status, setStatus] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [project, setProject] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState(null);
  const [directory, setDirectory] = useState("");
  const [file, setFile] = useState(null);

  const jobRunning = runningStatuses.includes(job?.status);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    getCodingStatus()
      .then(value => {
        if (!cancelled) setStatus(value);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    getProjects()
      .then(list => {
        if (!cancelled) setProjects(list);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, job?.status]);

  useEffect(() => {
    if (!visible || !jobId) return;

    let cancelled = false;

    const load = () => {
      getJob(jobId)
        .then(value => {
          if (cancelled) return;

          setJob(value);

          if (value.projectId) {
            setSelectedId(current => current || value.projectId);
          }
        })
        .catch(err => {
          if (!cancelled) setError(err.message);
        });
    };

    load();

    const timer = setInterval(load, jobRunning ? 2000 : 8000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible, jobId, jobRunning]);

  useEffect(() => {
    if (!visible || !selectedId) return;

    let cancelled = false;

    getProject(selectedId)
      .then(value => {
        if (!cancelled) setProject(value);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, selectedId, job?.status, job?.projectId]);

  useEffect(() => {
    if (!visible || !selectedId) return;

    let cancelled = false;

    getProjectEntries(selectedId, directory)
      .then(value => {
        if (!cancelled) setEntries(value);
      })
      .catch(err => {
        if (cancelled) return;

        setEntries(null);
        setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, selectedId, directory]);

  const refreshProject = useCallback(() => {
    if (!selectedId) return;

    getProject(selectedId)
      .then(setProject)
      .catch(err => setError(err.message));
  }, [selectedId]);

  async function beginGeneration() {
    if (!consent || !draft.trim() || busy) return;

    setBusy(true);
    setError("");

    try {
      const created = await startGeneration({
        request: draft.trim(),
        acceptTrustedWorkspaceRisk: true
      });

      setJobId(created.id);
      setJob(created);
      onDraftChange?.("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function stopJob() {
    if (!jobId) return;

    if (!window.confirm(
      "Cancel this generation? Completed files stay on disk and the " +
      "checkpoint is kept. The model request may still drain before it stops."
    )) {
      return;
    }

    try {
      await cancelJob(jobId);
    } catch (err) {
      setError(err.message);
    }
  }

  function selectProject(id) {
    setSelectedId(id);
    setDirectory("");
    setFile(null);
  }

  async function openEntry(name, type, size) {
    if (type === "directory") {
      setDirectory(current => joinPath(current, name));
      setFile(null);
      return;
    }

    if (Number.isFinite(size) && size > 200000) {
      setError("This file is too large to display (limit 200 KB).");
      return;
    }

    try {
      setFile(await getProjectFile(selectedId, joinPath(directory, name)));
    } catch (err) {
      setError(err.message);
    }
  }

  const counts = project?.counts;

  return (
    <section className="coding-workspace" hidden={!visible}>
      <header className="coding-header">
        <button
          className="icon-button"
          aria-label="Toggle sidebar"
          onClick={onMenu}
        >
          <Menu size={22} />
        </button>

        <div>
          <h2>Coding workspace</h2>
          <p>Local generation console</p>
        </div>

        <button
          className="icon-button"
          aria-label="Refresh projects"
          onClick={() => {
            refreshProject();
            getProjects().then(setProjects).catch(err => setError(err.message));
          }}
        >
          <RefreshCw size={18} />
        </button>

        <button
          className="icon-button"
          aria-label="Return to AI Chat"
          onClick={onBack}
        >
          <X size={22} />
        </button>
      </header>

      {error && (
        <div className="coding-error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="coding-body">
        <aside className="coding-side">
          <section className="coding-panel">
            <h3>Build a project</h3>

            <textarea
              rows={4}
              maxLength={1500}
              placeholder="Describe the project to generate..."
              value={draft}
              disabled={jobRunning}
              onChange={event => onDraftChange?.(event.target.value)}
            />

            <label className="coding-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={jobRunning}
                onChange={event => setConsent(event.target.checked)}
              />
              <span>
                I accept the restricted single-user workspace risk for this
                run. Files are written to the local projects folder; generated
                code is never executed.
              </span>
            </label>

            {status && !status.coordinatorConfigured && (
              <p className="coding-warning">
                AI_COORDINATOR_TOKEN is not configured in the backend, so
                generation cannot start.
              </p>
            )}

            <button
              className="coding-build"
              disabled={!consent || !draft.trim() || busy || jobRunning}
              onClick={beginGeneration}
            >
              {busy || jobRunning ? (
                <LoaderCircle size={16} className="processing-spin" />
              ) : (
                <Play size={16} />
              )}
              {jobRunning ? "Generation running" : "Start generation"}
            </button>

            {status && (
              <p className="coding-root" title={status.projectsRoot}>
                <HardDrive size={13} />
                {status.projectsRoot}
              </p>
            )}
          </section>

          {job && (
            <section className="coding-panel">
              <h3>
                <Layers size={15} />
                Current job
              </h3>

              <div className="coding-job-meta">
                <span className={`coding-state ${job.status}`}>
                  {job.status}
                </span>
                <span>{formatTime(job.startedAt)}</span>
              </div>

              {job.error && (
                <p className="coding-warning">{job.error}</p>
              )}

              {jobRunning && (
                <button className="coding-cancel" onClick={stopJob}>
                  <Square size={13} />
                  Cancel
                </button>
              )}

              {job.events?.length > 0 && (
                <ol className="coding-events">
                  {job.events.slice(-12).map((event, index) => (
                    <li key={`${event.at}-${index}`}>
                      {event.message}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <section className="coding-panel coding-projects">
            <h3>
              <FolderTree size={15} />
              Projects
            </h3>

            {!projects.length && (
              <p className="coding-empty">
                No generated projects yet.
              </p>
            )}

            {projects.map(item => (
              <button
                key={item.id}
                className={
                  "coding-project" +
                  (item.id === selectedId ? " selected" : "")
                }
                onClick={() => selectProject(item.id)}
              >
                <span className="coding-project-name">
                  {item.requestPreview || item.id}
                </span>
                <span className="coding-project-meta">
                  {item.status} - {item.counts.generated}/
                  {item.counts.total} files
                </span>
              </button>
            ))}
          </section>
        </aside>

        <main className="coding-main">
          {!project ? (
            <div className="coding-empty-state">
              <FolderTree size={44} />
              <h3>Select a project</h3>
              <p>
                Generated projects are listed on the left. File contents are
                shown read-only; editing arrives with a later milestone.
              </p>
            </div>
          ) : (
            <>
              <section className="coding-panel">
                <h3>{project.requestPreview || project.id}</h3>

                <div className="coding-job-meta">
                  <span className={`coding-state ${project.status}`}>
                    {project.status}
                  </span>
                  <span>{project.id}</span>
                  <span>Updated {formatTime(project.updatedAt)}</span>
                </div>

                {counts && (
                  <div className="coding-counts">
                    <span>Total {counts.total}</span>
                    <span>Generated {counts.generated}</span>
                    <span>Pending {counts.pending}</span>
                    <span>Failed {counts.failed}</span>
                    <span>Blocked {counts.blocked}</span>
                  </div>
                )}

                {project.targets?.length > 0 && (
                  <ul className="coding-targets">
                    {project.targets.map(target => (
                      <li key={target.path}>
                        <span className={`coding-task ${target.status}`}>
                          {statusIcon(target.status)}
                          {target.path}
                        </span>
                        <span className="coding-task-meta">
                          {target.status}
                          {target.attempts
                            ? ` - attempt ${target.attempts}`
                            : ""}
                          {target.validation
                            ? ` - ${target.validation}`
                            : ""}
                        </span>
                        {target.error && (
                          <span className="coding-task-error">
                            {target.error}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="coding-panel coding-explorer">
                <h3>
                  <FileCode2 size={15} />
                  Files
                </h3>

                <div className="coding-breadcrumb">
                  <button onClick={() => setDirectory("")}>
                    project root
                  </button>

                  {directory.split("/").filter(Boolean).map((segment, index, parts) => (
                    <span key={`${segment}-${index}`}>
                      <ChevronRight size={13} />
                      <button
                        onClick={() =>
                          setDirectory(parts.slice(0, index + 1).join("/"))
                        }
                      >
                        {segment}
                      </button>
                    </span>
                  ))}
                </div>

                {directory && (
                  <button
                    className="coding-entry up"
                    onClick={() => {
                      setDirectory(parentPath(directory));
                      setFile(null);
                    }}
                  >
                    <Folder size={14} />
                    ..
                  </button>
                )}

                {entries?.entries?.length ? (
                  <ul className="coding-entries">
                    {entries.entries.map(entry => (
                      <li key={entry.name}>
                        <button
                          className="coding-entry"
                          onClick={() =>
                            openEntry(entry.name, entry.type, entry.size)
                          }
                        >
                          {entry.type === "directory" ? (
                            <Folder size={14} />
                          ) : (
                            <FileCode2 size={14} />
                          )}
                          <span>{entry.name}</span>
                          {Number.isFinite(entry.size) && (
                            <span className="coding-entry-size">
                              {entry.size} B
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="coding-empty">
                    {entries ? "This folder is empty." : "Loading files..."}
                  </p>
                )}

                {file && (
                  <div className="coding-file">
                    <div className="coding-file-head">
                      <span>{file.path}</span>
                      <span>{file.size} B</span>
                    </div>
                    <pre>{file.binary
                      ? "Binary file preview is unavailable."
                      : file.content}</pre>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>

      <footer className="coding-footer">
        Local workspace only - generated code is not executed by this console
      </footer>
    </section>
  );
}
