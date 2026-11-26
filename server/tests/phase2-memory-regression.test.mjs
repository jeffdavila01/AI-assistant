import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMemory, saveMemory, updateMemory, deleteMemory, clearMemory, setMemoryEnabled, getMemoryContext } from "../memory/store.js";

test("memory management with an in-memory filesystem leaves the user's memory file untouched", () => {
  const dir = fileURLToPath(new URL("../../database/", import.meta.url));
  const file = path.join(dir, "memory.json");
  const data = new Map(), names = ["existsSync", "readFileSync", "mkdirSync", "writeFileSync", "renameSync", "unlinkSync"];
  const original = Object.fromEntries(names.map(name => [name, fs[name]]));
  const ours = value => typeof value === "string" && (value === file || value.startsWith(file + "."));
  try {
    fs.existsSync = value => ours(value) ? data.has(value) : original.existsSync(value);
    fs.readFileSync = (value, ...args) => ours(value) ? data.get(value) : original.readFileSync(value, ...args);
    fs.mkdirSync = (value, ...args) => value === dir ? undefined : original.mkdirSync(value, ...args);
    fs.writeFileSync = (value, content, ...args) => ours(value) ? data.set(value, String(content)) : original.writeFileSync(value, content, ...args);
    fs.renameSync = (from, to) => {
      if (ours(from) && ours(to)) { data.set(to, data.get(from)); data.delete(from); return; }
      return original.renameSync(from, to);
    };
    fs.unlinkSync = value => ours(value) ? data.delete(value) : original.unlinkSync(value);
    assert.equal(getMemory().enabled, true);
    const saved = saveMemory("Test-only preferred language is English.", "preference");
    assert.equal(saveMemory("Test-only preferred language is English.", "preference").id, saved.id);
    assert.equal(updateMemory(saved.id, "Test-only preference is JavaScript.", "preference").id, saved.id);
    assert.match(getMemoryContext([{ role: "user", content: "JavaScript preference" }]), /JavaScript/);
    assert.equal(deleteMemory(saved.id), true);
    saveMemory("Another test item", "general");
    clearMemory();
    assert.equal(getMemory().memories.length, 0);
    setMemoryEnabled(false);
    assert.throws(() => saveMemory("not saved"), /disabled/);
  } finally { for (const name of names) fs[name] = original[name]; }
});
