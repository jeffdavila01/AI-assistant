const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was",
  "what", "how", "why", "when", "where",
  "can", "could", "would", "should",
  "you", "your", "me", "my", "it",
  "this", "that", "and", "or", "of",
  "to", "for", "in", "on", "with",
  "ang", "ng", "mga", "sa", "na",
  "ano", "paano", "bakit", "ako",
  "mo", "ko", "ito", "iyan", "yung"
]);

function getWords(text = "") {
  return new Set(
    (String(text).toLowerCase()
      .match(/[\p{L}\p{N}_-]+/gu) || [])
      .filter(word =>
        word.length > 2 &&
        !STOP_WORDS.has(word)
      )
  );
}

export function estimateTokens(text = "") {
  return Math.ceil(
    String(text).length / 3
  );
}

function relevanceScore(message, keywords) {
  const words = getWords(message.content);

  let score = 0;

  for (const word of keywords) {
    if (words.has(word)) score++;
  }

  return score;
}

export function buildContext(
  messages = [],
  model = "qwen2.5-coder:7b",
  systemPrompt = ""
) {
  const instant = model === "qwen2.5:1.5b";

  const contextWindow = instant ? 2048 : 4096;

  const outputReserve = instant ? 256 : 1024;

  const safetyReserve = 256;

  const budget =
    contextWindow -
    outputReserve -
    safetyReserve -
    estimateTokens(systemPrompt);

  const valid = messages.filter(
    message =>
      ["user", "assistant"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content.trim()
  );

  if (valid.length === 0) return [];

  const latest = valid[valid.length - 1];

  const latestCost =
    estimateTokens(latest.content) + 12;

  if (latestCost > budget) {
    throw new Error(
      "Message exceeds available AI context. " +
      "Please shorten the message or use a larger model."
    );
  }

  const keywords = getWords(latest.content);

  const selected = new Set([valid.length - 1]);

  let used = latestCost;

  function addMessage(index) {
    if (selected.has(index)) return true;

    const cost =
      estimateTokens(valid[index].content) + 12;

    if (used + cost > budget) return false;

    selected.add(index);
    used += cost;

    return true;
  }

  const recentLimit = instant ? 4 : 8;

  const recentStart = Math.max(
    0,
    valid.length - recentLimit
  );

  for (
    let index = valid.length - 2;
    index >= recentStart;
    index--
  ) {
    if (!addMessage(index)) break;
  }

  const older = valid
    .slice(0, recentStart)
    .map((message, index) => ({
      index,
      score: relevanceScore(message, keywords)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) =>
      b.score - a.score || b.index - a.index
    );

  for (const item of older) {
    addMessage(item.index);
  }

  const context = [...selected]
    .sort((a, b) => a - b)
    .map(index => ({
      role: valid[index].role,
      content: valid[index].content
    }));

  console.log(
    `[CONTEXT] ${model}: ` +
    `${context.length}/${valid.length} messages, ` +
    `~${used}/${budget} history tokens`
  );

  return context;
}
