import assert from "node:assert/strict";
import { buildContext } from "../ai/contextManager.js";

const model = "qwen2.5:1.5b";

const messages = [
  {
    role: "user",
    content: "My project uses Supabase for the database."
  },
  {
    role: "assistant",
    content: "Supabase will store the project data."
  },
  ...Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "Unrelated conversation about food and travel. ".repeat(20)
  })),
  {
    role: "user",
    content: "How should I configure Supabase?"
  }
];

const original = JSON.stringify(messages);

const result = buildContext(
  messages,
  model
);

assert.ok(result.length < messages.length);

console.log("PASS: Long history optimized");

assert.equal(
  result.at(-1).content,
  messages.at(-1).content
);

console.log("PASS: Latest user message preserved");

assert.ok(
  result.some(message =>
    message.content.includes("My project uses Supabase")
  )
);

console.log("PASS: Relevant older message retained");

assert.equal(
  JSON.stringify(messages),
  original
);

console.log("PASS: Original history unchanged");

assert.deepEqual(buildContext([]), []);

console.log("PASS: Empty history handled");

assert.throws(() =>
  buildContext([
    {
      role: "user",
      content: "Long message ".repeat(3000)
    }
  ], model)
);

console.log("PASS: Oversized input handled");

console.log("\nALL CONTEXT TESTS PASSED");
