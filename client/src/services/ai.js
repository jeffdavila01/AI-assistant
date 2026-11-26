const BASE_URL = "http://localhost:5000/api/chat";

export async function getModels() {
  const response = await fetch(`${BASE_URL}/models`);
  if (!response.ok) {
    throw new Error("Unable to load AI models.");
  }

  const data = await response.json();
  return data.models || [];
}

export async function streamChat({
  messages,
  model,
  signal,
  onEvent
}) {
  const response = await fetch(`${BASE_URL}/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ messages, model }),
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(`AI request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let completed = false;

  function processLine(line) {
    if (!line.trim()) return;

    const event = JSON.parse(line);

    if (event.type === "error") {
      throw new Error(
        event.message || "AI response failed."
      );
    }

    if (event.type === "done") {
      completed = true;
    }

    onEvent(event);
  }

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, {
        stream: true
      });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        processLine(line);
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      processLine(buffer);
    }

    if (!completed) {
      throw new Error("AI response ended unexpectedly.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
