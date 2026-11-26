import fs from "node:fs/promises";
import path from "node:path";
import { resumeProject, RESTRICTED_WORKSPACE_CONSENT } from "../coding/generator/engine.mjs";

const [root, id, stage] = process.argv.slice(2);
const project = path.join(root, id), source = path.join(project, "file.js");
const originalOpen = fs.open.bind(fs), originalRename = fs.rename.bind(fs);
const gate = async label => {
  if (label !== stage) return;
  process.send?.({ ready: label });
  await new Promise(() => {});
};
const isTemp = value => path.basename(String(value)).startsWith(".checkpoint-");

fs.open = async (file, ...args) => {
  if (String(file) === source && stage === "before-source") await gate(stage);
  if (isTemp(file) && stage === "before-temp") {
    try { await fs.stat(source); await gate(stage); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const handle = await originalOpen(file, ...args);
  const write = handle.writeFile.bind(handle), sync = handle.sync.bind(handle);
  if (String(file) === source && stage === "during-source") {
    handle.writeFile = async content => {
      await write(String(content).slice(0, 8), "utf8"); await sync(); await gate(stage);
    };
  }
  if (String(file) === source && stage === "after-source") {
    handle.sync = async () => { await sync(); await gate(stage); };
  }
  if (isTemp(file) && stage === "during-temp") {
    handle.writeFile = async (content, ...more) => {
      let parsed;
      try { parsed = JSON.parse(String(content)); } catch {}
      if (parsed?.tasks?.[0]?.status === "generated") {
        await write(String(content).slice(0, 20), "utf8"); await sync(); await gate(stage);
      }
      return write(content, ...more);
    };
  }
  return handle;
};
fs.rename = async (from, to) => {
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(from, "utf8")); } catch {}
  const generated = parsed?.tasks?.[0]?.status === "generated";
  if (generated && stage === "before-replace") await gate(stage);
  await originalRename(from, to);
  if (generated && stage === "after-replace") await gate(stage);
};

try {
  await resumeProject(root, id, async () => ({ doneReason: "stop", content: JSON.stringify({ code: "export const value = 42;" }) }),
    new AbortController().signal, () => {}, { restrictedWorkspaceConsent: RESTRICTED_WORKSPACE_CONSENT });
  process.send?.({ error: "Expected stage was not reached." });
  process.exitCode = 1;
} catch (error) {
  process.send?.({ error: error.message });
  process.exitCode = 1;
}
