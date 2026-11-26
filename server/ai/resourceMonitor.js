import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getCodingProfile } from "./codingBudget.js";

const defaultMarker = fileURLToPath(
  new URL("../../workspace/.local-inference-active", import.meta.url)
);

export function assessMemory(totalBytes, freeBytes) {
  if (
    !Number.isFinite(totalBytes) ||
    !Number.isFinite(freeBytes) ||
    totalBytes <= 0 ||
    freeBytes < 0 ||
    freeBytes > totalBytes
  ) {
    throw new Error("Invalid system memory readings.");
  }

  const totalMiB = Math.floor(totalBytes / 1048576);
  const availableMiB = Math.floor(freeBytes / 1048576);
  const usedMiB = totalMiB - availableMiB;

  const memoryPressure =
    availableMiB < 2048 ? "critical" :
    availableMiB < 6144 ? "high" :
    "normal";

  return {
    totalMiB,
    availableMiB,
    usedMiB,
    availablePercent: Number(
      ((freeBytes / totalBytes) * 100).toFixed(2)
    ),
    memoryPressure
  };
}

export function getResourceSnapshot({
  totalBytes = os.totalmem(),
  freeBytes = os.freemem(),
  logicalCPU = os.cpus().length,
  markerExists = fs.existsSync(defaultMarker),
  env = process.env
} = {}) {
  const memory = assessMemory(totalBytes, freeBytes);

  const warnings = [];

  if (memory.memoryPressure === "critical") {
    warnings.push(
      "Very low available memory. Close unused applications before local inference."
    );
  } else if (memory.memoryPressure === "high") {
    warnings.push(
      "Limited memory headroom for a 7B model. Review memory before inference."
    );
  }

  if (markerExists) {
    warnings.push(
      "Inference safety marker retained. Controlled recovery approval is required."
    );
  }

  return {
    checkedAt: new Date().toISOString(),
    logicalCPU,
    memory,
    inferenceBlocked: Boolean(markerExists),
    profiles: {
      planning: getCodingProfile("planning", env),
      generation: getCodingProfile("generation", env)
    },
    warnings
  };
}