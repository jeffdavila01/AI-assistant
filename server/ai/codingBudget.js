export const CODING_CONTEXT_TOKENS = 4096;
export const CODING_OUTPUT_TOKENS = 1200;
export const CODING_SAFETY_TOKENS = 256;

function readSetting(env, name, fallback, min, max) {
  const raw = env[name];

  if (raw === undefined) return fallback;

  const value = Number(raw);

  if (
    !/^\d+$/.test(String(raw)) ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error("Invalid coding resource setting: " + name);
  }

  return value;
}

export function getCodingProfile(
  stage = "generation",
  env = process.env
) {
  if (!["planning", "generation"].includes(stage)) {
    throw new Error("Invalid coding stage.");
  }

  const contextTokens = readSetting(
    env,
    "AI_CODING_CONTEXT_TOKENS",
    CODING_CONTEXT_TOKENS,
    2048,
    4096
  );

  const outputSetting = stage === "planning"
    ? "AI_CODING_PLANNING_OUTPUT_TOKENS"
    : "AI_CODING_GENERATION_OUTPUT_TOKENS";

  const outputTokens = readSetting(
    env,
    outputSetting,
    CODING_OUTPUT_TOKENS,
    256,
    2048
  );

  const inputBudget =
    contextTokens - outputTokens - CODING_SAFETY_TOKENS;

  if (inputBudget < 1024) {
    throw new Error(
      "Coding configuration leaves insufficient input budget."
    );
  }

  return {
    stage,
    contextTokens,
    outputTokens,
    safetyTokens: CODING_SAFETY_TOKENS,
    inputBudget
  };
}

// Conservative heuristic; not the actual model tokenizer.
// Never silently truncate requirements or dependency context.
export function assessCodingBudget(messages, profile = {
  contextTokens: CODING_CONTEXT_TOKENS,
  outputTokens: CODING_OUTPUT_TOKENS
}) {
  const inputBytes = Buffer.byteLength(
    JSON.stringify(messages),
    "utf8"
  );

  const estimatedInputTokens =
    Math.ceil(inputBytes / 3) + messages.length * 12;

  const inputBudget =
    profile.contextTokens -
    profile.outputTokens -
    CODING_SAFETY_TOKENS;

  return {
    inputBytes,
    estimatedInputTokens,
    inputBudget,
    exceedsEstimate: estimatedInputTokens > inputBudget
  };
}