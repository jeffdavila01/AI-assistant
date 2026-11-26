import test from "node:test";
import assert from "node:assert/strict";

import {
  getCodingProfile,
  assessCodingBudget
} from "../ai/codingBudget.js";

test("default resource settings preserve existing behavior", () => {
  const profile = getCodingProfile("planning", {});

  assert.equal(profile.contextTokens, 4096);
  assert.equal(profile.outputTokens, 1200);
  assert.equal(profile.inputBudget, 2640);
});

test("planning and generation use separate output settings", () => {
  const env = {
    AI_CODING_CONTEXT_TOKENS: "3072",
    AI_CODING_PLANNING_OUTPUT_TOKENS: "768",
    AI_CODING_GENERATION_OUTPUT_TOKENS: "1200"
  };

  assert.equal(
    getCodingProfile("planning", env).outputTokens,
    768
  );

  assert.equal(
    getCodingProfile("generation", env).outputTokens,
    1200
  );
});

test("invalid resource settings are rejected", () => {
  assert.throws(() => getCodingProfile("planning", {
    AI_CODING_CONTEXT_TOKENS: "999999"
  }), /Invalid coding resource setting/);

  assert.throws(() => getCodingProfile("planning", {
    AI_CODING_CONTEXT_TOKENS: "2048",
    AI_CODING_PLANNING_OUTPUT_TOKENS: "1800"
  }), /insufficient input budget/);
});

test("oversized prompts are detected without truncation", () => {
  const messages = [
    { role: "user", content: "a".repeat(15000) }
  ];

  const original = JSON.stringify(messages);

  const result = assessCodingBudget(
    messages,
    getCodingProfile("generation", {})
  );

  assert.equal(result.exceedsEstimate, true);
  assert.equal(JSON.stringify(messages), original);
});

test("small prompts fit the selected resource budget", () => {
  const result = assessCodingBudget(
    [{ role: "user", content: "Create a Python function." }],
    getCodingProfile("planning", {})
  );

  assert.equal(result.exceedsEstimate, false);
});