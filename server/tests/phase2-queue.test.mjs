import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalQueue } from "../ai/requestQueue.js";

async function setup(queueMs = 1000, activeMs = 1000) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-assistant-queue-"));
  const marker = path.join(dir, "marker");
  const queue = createLocalQueue({ marker, queueMs, activeMs });
  queue.enable();
  return { queue, marker };
}
const controller = () => new AbortController();
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test("FIFO serializes different callers and cancelled active work retains the slot", async () => {
  const { queue, marker } = await setup();
  const first = deferred(), signal = controller(), events = [];
  const a = queue.enqueue(() => { events.push("chat"); return first.promise; }, signal.signal);
  await new Promise(resolve => setImmediate(resolve));
  const b = queue.enqueue(() => { events.push("generator"); return "ok"; }, controller().signal);
  signal.abort(new Error("cancelled"));
  await assert.rejects(a, /cancelled/);
  assert.equal(queue.status().active, 1);
  assert.deepEqual(events, ["chat"]);
  await fs.stat(marker);
  first.resolve("complete");
  assert.equal(await b, "ok");
  assert.deepEqual(events, ["chat", "generator"]);
});

test("queued cancellation and queue timeout do not start work", async () => {
  const { queue } = await setup(40, 1000);
  const first = deferred();
  const a = queue.enqueue(() => first.promise, controller().signal);
  const cancelled = controller();
  let ran = false;
  const b = queue.enqueue(() => { ran = true; }, cancelled.signal);
  const c = queue.enqueue(() => { ran = true; }, controller().signal);
  cancelled.abort(new Error("queued cancellation"));
  await assert.rejects(b, /queued cancellation/);
  await assert.rejects(c, /queue wait timed out/);
  assert.equal(ran, false);
  first.resolve();
  await a;
});

test("active timeout keeps the provider slot until the provider finishes", async () => {
  const { queue } = await setup(1000, 30);
  const first = deferred();
  const a = queue.enqueue(() => first.promise, controller().signal);
  await assert.rejects(a, /Active inference timed out/);
  assert.equal(queue.status().active, 1);
  first.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.status().active, 0);
});

test("per-request active deadline starts only after queue admission", async () => {
  const { queue } = await setup(1000, 1000);
  const first = deferred(), second = deferred();
  const a = queue.enqueue(() => first.promise, controller().signal);
  const b = queue.enqueue(() => second.promise, controller().signal, () => {}, { activeMs: 100 });
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(queue.status().waiting, 1);
  first.resolve();
  await a;
  await assert.rejects(b, /Active inference timed out/);
  assert.equal(queue.status().active, 1);
  second.resolve();
  await new Promise(resolve => setImmediate(resolve));
});

test("uncertain provider failure leaves a marker and blocks restart", async () => {
  const { queue, marker } = await setup();
  await assert.rejects(queue.enqueue(() => { throw new Error("provider disconnected"); }, controller().signal), /disconnected/);
  await fs.stat(marker);
  assert.equal(queue.status().providerStateUncertain, true);
  const restarted = createLocalQueue({ marker });
  restarted.enable();
  await assert.rejects(restarted.enqueue(() => 1, controller().signal), /prior provider request/);
});
