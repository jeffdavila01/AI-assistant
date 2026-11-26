import test from "node:test";
import assert from "node:assert/strict";
import { validateCheckpoint, replaceCheckpoint } from "../coding/generator/engine.mjs";

test("initial hierarchical checkpoint is validated without filesystem access", () => {
  const id = "project-1-abcdef12", now = new Date().toISOString();
  const state = { schemaVersion: 2, projectId: id, request: "Test", status: "planning",
    createdAt: now, updatedAt: now, master: null, modulePlans: [], tasks: [] };
  assert.doesNotThrow(() => validateCheckpoint(state, id));
  assert.throws(() => validateCheckpoint({ ...state, status: "pending" }, id), /planning checkpoint/);
  assert.throws(() => validateCheckpoint({ ...state, projectId: "wrong" }, id), /Invalid checkpoint/);
  assert.throws(() => validateCheckpoint({ ...state, tasks: [{ id: "unexpected" }] }, id), /count mismatch/);
});

test("checkpoint replacement retries bounded transient errors", async () => {
  let calls = 0;
  await replaceCheckpoint("from", "to", async () => {
    calls++;
    if (calls < 3) { const error = new Error("busy"); error.code = "EPERM"; throw error; }
  });
  assert.equal(calls, 3);
  let fatalCalls = 0;
  await assert.rejects(replaceCheckpoint("from", "to", async () => {
    fatalCalls++; const error = new Error("fatal"); error.code = "EINVAL"; throw error;
  }), /fatal/);
  assert.equal(fatalCalls, 1);
});

test("an expired persistence deadline does not start a replacement", async () => {
  let called = false;
  await assert.rejects(replaceCheckpoint("from", "to", async () => { called = true; }, Date.now() - 1), /deadline/);
  assert.equal(called, false);
});
