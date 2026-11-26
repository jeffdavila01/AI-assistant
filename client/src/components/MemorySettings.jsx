import { useState, useEffect, useRef } from "react";
import {
  Brain, X, Plus, Pencil, Trash2, Save
} from "lucide-react";

import { memoryAPI } from "../services/memory";

const CATEGORIES = [
  "profile",
  "preference",
  "project",
  "instruction",
  "general"
];

export default function MemorySettings() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const lock = useRef(false);

  async function run(operation, message = "") {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await operation();
      const latest = await memoryAPI.list();
      setData(latest);
      setNotice(message);
    } catch (err) {
      setError(err.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function resetForm() {
    setContent("");
    setCategory("general");
    setEditing(null);
  }

  function showSettings() {
    setData(null);
    resetForm();
    setOpen(true);
    run(async () => {});
  }

  function closeSettings() {
    if (!lock.current) {
      setOpen(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    function handleKey(event) {
      if (event.key === "Escape" && !lock.current) {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKey);

    return () =>
      window.removeEventListener("keydown", handleKey);
  }, [open]);

  async function save(event) {
    event.preventDefault();

    if (!content.trim() || !data?.enabled) return;

    await run(async () => {
      if (editing) {
        await memoryAPI.update(
          editing, content.trim(), category
        );
      } else {
        await memoryAPI.add(
          content.trim(), category
        );
      }

      resetForm();
    }, editing ? "Memory updated." : "Memory saved.");
  }

  function edit(memory) {
    setEditing(memory.id);
    setContent(memory.content);
    setCategory(memory.category);
    setNotice("");
  }

  function remove(memory) {
    if (!window.confirm("Delete this saved memory?")) {
      return;
    }

    run(async () => {
      await memoryAPI.remove(memory.id);

      if (editing === memory.id) {
        resetForm();
      }
    }, "Memory deleted.");
  }

  function clearAll() {
    if (!window.confirm(
      "Permanently delete all saved memories?"
    )) return;

    run(async () => {
      await memoryAPI.clear();
      resetForm();
    }, "All saved memories deleted.");
  }

  return (
    <>
      <button
        className="theme-button"
        onClick={showSettings}
      >
        <Brain size={18} />
        Personalization
      </button>

      {open && (
        <div
          className="memory-overlay"
          onClick={event => {
            if (event.target === event.currentTarget) {
              closeSettings();
            }
          }}
        >
          <section
            className="memory-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Memory settings"
          >
            <header className="memory-header">
              <Brain size={25} />

              <div>
                <h2>Personalization</h2>
                <p>Manage your saved memories</p>
              </div>

              <button
                className="icon-button"
                aria-label="Close memory settings"
                disabled={busy}
                onClick={closeSettings}
              >
                <X size={20} />
              </button>
            </header>

            {error && (
              <p className="memory-error" role="alert">
                {error}
              </p>
            )}

            {notice && (
              <p className="memory-notice" role="status">
                {notice}
              </p>
            )}

            {!data ? (
              <p>
                {busy
                  ? "Loading memories..."
                  : "Unable to load memories."}
              </p>
            ) : (
              <>
                <div className="memory-toggle-row">
                  <div>
                    <strong>Persistent memory</strong>
                    <p>
                      Use saved information across chats.
                    </p>
                  </div>

                  <button
                    disabled={busy}
                    role="switch"
                    aria-checked={data.enabled}
                    className={
                      "memory-switch " +
                      (data.enabled ? "enabled" : "")
                    }
                    onClick={() =>
                      run(
                        () => memoryAPI.setEnabled(
                          !data.enabled
                        ),
                        data.enabled
                          ? "Memory disabled."
                          : "Memory enabled."
                      )
                    }
                  >
                    <span />
                  </button>
                </div>

                <div className="memory-list-heading">
                  <strong>Saved memories</strong>
                  <span>{data.memories.length} records</span>
                </div>

                <div className="memory-list">
                  {!data.memories.length && (
                    <p className="memory-empty">
                      No saved memories yet.
                    </p>
                  )}

                  {data.memories.map(memory => (
                    <article
                      className="memory-item"
                      key={memory.id}
                    >
                      <div className="memory-item-top">
                        <span>{memory.category}</span>

                        <div>
                          <button
                            className="icon-button"
                            aria-label="Edit memory"
                            disabled={busy || !data.enabled}
                            onClick={() => edit(memory)}
                          >
                            <Pencil size={15} />
                          </button>

                          <button
                            className="icon-button"
                            aria-label="Delete memory"
                            disabled={busy}
                            onClick={() => remove(memory)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      <p>{memory.content}</p>
                    </article>
                  ))}
                </div>

                <form
                  className="memory-form"
                  onSubmit={save}
                >
                  <strong>
                    {editing ? "Edit memory" : "Add memory"}
                  </strong>

                  <select
                    value={category}
                    aria-label="Memory category"
                    disabled={busy || !data.enabled}
                    onChange={event =>
                      setCategory(event.target.value)
                    }
                  >
                    {CATEGORIES.map(item => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>

                  <textarea
                    value={content}
                    aria-label="Memory content"
                    placeholder="What should I remember?"
                    maxLength={1000}
                    rows={3}
                    disabled={busy || !data.enabled}
                    onChange={event =>
                      setContent(event.target.value)
                    }
                  />

                  <button
                    type="submit"
                    className="memory-save"
                    disabled={
                      busy || !data.enabled ||
                      !content.trim()
                    }
                  >
                    {editing
                      ? <Save size={17} />
                      : <Plus size={17} />}

                    {editing
                      ? "Save changes"
                      : "Save memory"}
                  </button>

                  {editing && (
                    <button
                      type="button"
                      className="memory-cancel"
                      disabled={busy}
                      onClick={resetForm}
                    >
                      Cancel editing
                    </button>
                  )}
                </form>

                <button
                  className="memory-clear"
                  disabled={busy || !data.memories.length}
                  onClick={clearAll}
                >
                  <Trash2 size={16} />
                  Clear all memories
                </button>

                <p className="memory-privacy">
                  Avoid storing passwords, API keys,
                  or other confidential credentials.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
