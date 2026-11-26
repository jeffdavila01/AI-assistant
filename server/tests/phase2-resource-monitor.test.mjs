import test from "node:test";
import assert from "node:assert/strict";

import {
  assessMemory,
  getResourceSnapshot
} from "../ai/resourceMonitor.js";

const GiB = 1024 ** 3;

test("normal memory headroom is detected", () => {
  const result = assessMemory(16 * GiB, 8 * GiB);

  assert.equal(result.availableMiB, 8192);
  assert.equal(result.availablePercent, 50);
  assert.equal(result.memoryPressure, "normal");
});

test("high memory pressure is detected", () => {
  const result = assessMemory(16 * GiB, 4 * GiB);

  assert.equal(result.memoryPressure, "high");
});

test("critical memory pressure is detected", () => {
  const result = assessMemory(16 * GiB, 1 * GiB);

  assert.equal(result.memoryPressure, "critical");
});

test("invalid memory readings are rejected", () => {
  assert.throws(
    () => assessMemory(16 * GiB, 20 * GiB),
    /Invalid system memory/
  );

  assert.throws(
    () => assessMemory(0, 0),
    /Invalid system memory/
  );
});

test("retained inference marker is reported without changing it", () => {
  const snapshot = getResourceSnapshot({
    totalBytes: 16 * GiB,
    freeBytes: 4 * GiB,
    logicalCPU: 8,
    markerExists: true,
    env: {}
  });

  assert.equal(snapshot.inferenceBlocked, true);
  assert.equal(snapshot.logicalCPU, 8);

  assert.ok(
    snapshot.warnings.some(
      warning => warning.includes("safety marker")
    )
  );
});

test("resource snapshot includes separate coding profiles", () => {
  const snapshot = getResourceSnapshot({
    totalBytes: 16 * GiB,
    freeBytes: 8 * GiB,
    markerExists: false,
    env: {
      AI_CODING_PLANNING_OUTPUT_TOKENS: "768",
      AI_CODING_GENERATION_OUTPUT_TOKENS: "1200"
    }
  });

  assert.equal(
    snapshot.profiles.planning.outputTokens,
    768
  );

  assert.equal(
    snapshot.profiles.generation.outputTokens,
    1200
  );
});