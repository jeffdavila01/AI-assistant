export const MODELS = [
  {
    id: "qwen2.5:1.5b",
    name: "Instant - Qwen 1.5B",
    provider: "ollama"
  },
  {
    id: "qwen2.5-coder:7b",
    name: "Detailed - Qwen 7B",
    provider: "ollama"
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    provider: "gemini"
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    provider: "gemini"
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "gemini"
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini"
  }
];

export function getModelCandidates(
  selection = "auto",
  messages = []
) {
  if (selection === "auto") {
    const latest = messages.at(-1)?.content?.trim() || "";

    const simpleEnglish =
      /^(what is|define|what does)\s+[a-zA-Z\s]{2,40}\??$/i
        .test(latest);

    const technical =
      /\b(code|python|javascript|react|database|api|debug|programming|html|css|software)\b/i
        .test(latest);

    if (
      messages.length === 1 &&
      simpleEnglish &&
      !technical
    ) {
      return ["qwen2.5:1.5b"];
    }

    return ["qwen2.5-coder:7b"];
  }

  if (!MODELS.some(model => model.id === selection)) {
    throw new Error("Unsupported AI model.");
  }

  return [selection];
}

export function isRetryable(error) {
  return [500, 502, 503, 504].includes(
    Number(error.status)
  );
}
