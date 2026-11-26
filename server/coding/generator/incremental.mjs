import { createHierarchicalProject, resumeProject, defaultRoot, RESTRICTED_WORKSPACE_CONSENT } from "./engine.mjs";
import { requestCoordinator } from "./client.mjs";

const args = process.argv.slice(2);
const consentFlag = "--accept-trusted-workspace-risk";
const accepted = args[0] === consentFlag;
if (accepted) args.shift();
const controller = new AbortController();
process.once("SIGINT", () => controller.abort(new Error("Cancelled by user.")));
process.once("SIGTERM", () => controller.abort(new Error("Cancelled by user.")));

async function provider(messages, signal, options = {}) {
  const token = process.env.AI_COORDINATOR_TOKEN;
  const started = Date.now();
  const result = await requestCoordinator(messages, token, signal, options);
  console.log("Inference response received in " + ((Date.now() - started) / 1000).toFixed(1) + " seconds.");
  if (Number.isInteger(result.promptEvalCount) && result.promptEvalCount >= 0) console.log("Model-reported prompt tokens: " + result.promptEvalCount);
  if (result.evalCount && result.evalDuration) console.log("Model evaluation: " + (result.evalCount / (result.evalDuration / 1e9)).toFixed(2) + " tokens/second.");
  return result;
}

async function main() {
  if (!accepted) {
    throw new Error("Automatic project writes are blocked. Review PHASE2_RESTRICTED_MODE.md; only if you accept its single-user threat model, invoke with --accept-trusted-workspace-risk.");
  }
  let id;
  let retryTask;
  let expectedTargets;
  const expectedIndex = args.indexOf("--expected-targets");
  if (expectedIndex !== -1) {
    if (args[0] !== "--resume" || expectedIndex !== args.length - 2 || !args[expectedIndex + 1]) throw new Error("Use --expected-targets as the last option with a comma-separated target list.");
    expectedTargets = args[expectedIndex + 1].split(",");
    args.splice(expectedIndex, 2);
  }
  if (args[0] === "--resume" && (args.length === 2 || (args.length === 4 && args[2] === "--retry"))) {
    id = args[1];
    retryTask = args[3];
  } else if (args[0]?.startsWith("--")) {
    throw new Error("Usage: incremental.mjs --accept-trusted-workspace-risk <prompt> OR --accept-trusted-workspace-risk --resume <project-id> [--retry <failed-task-id>]");
  } else {
    const project = await createHierarchicalProject(defaultRoot, args.join(" ").trim(), provider, controller.signal, {
      restrictedWorkspaceConsent: RESTRICTED_WORKSPACE_CONSENT,
      onProjectCreated: ({ id }) => {
        console.log("Project: " + id);
        console.log("Resume with: node server/coding/generator/incremental.mjs --accept-trusted-workspace-risk --resume " + id);
      }
    });
    id = project.id;
  }
  await resumeProject(defaultRoot, id, provider, controller.signal, console.log, { retryTask, expectedTargets, restrictedWorkspaceConsent: RESTRICTED_WORKSPACE_CONSENT });
  console.log("Source generation completed. Runtime and functional tests have not been performed.");
}

main().catch(error => { console.error("Generation stopped: " + error.message); process.exitCode = 1; });
