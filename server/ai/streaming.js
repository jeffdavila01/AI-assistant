import { getSearchQuery, prepareSearch, formatSources } from "../tools/search/searchRouter.js";
import { enqueueLocalAI } from "./requestQueue.js";
import { handleCommand } from "../tools/commandRouter.js";
import { streamOllama } from "./ollama.js";
import { getMemoryContext } from "../memory/store.js";
import { GoogleGenAI } from "@google/genai";
import {
  getModelCandidates,
  isRetryable
} from "./modelRouter.js";

async function generateStream(
  messages,
  selection,
  signal,
  onEvent,
  researchContext = ""
) {
  signal.throwIfAborted();

  const command = handleCommand(messages);

  if (command.handled) {
    onEvent({
      type: "model",
      model: command.model
    });

    onEvent({
      type: "delta",
      text: command.text
    });

    onEvent({
      type: "done",
      model: command.model
    });

    return;
  }

  const candidates = getModelCandidates(selection, messages);

  if (candidates[0].startsWith("qwen2.5")) {
    return enqueueLocalAI(
      () => streamOllama(
        messages,
        candidates[0],
        new AbortController().signal,
        event => { if (!signal.aborted) onEvent(event); },
        researchContext
      ),
      signal,
      onEvent
    );
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });
  // Cloud requests receive their own active deadline after research has finished.
  signal = AbortSignal.any([signal, AbortSignal.timeout(900000)]);

  let lastError;

  for (const model of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let started = false;

      try {
        signal.throwIfAborted();

        const stream = await ai.models.generateContentStream({
          model,
          contents: messages.map(message => ({
            role: message.role === "assistant"
              ? "model"
              : "user",
            parts: [{ text: message.content }]
          })),
          config: {
            abortSignal: signal,
            maxOutputTokens: 4096,
            systemInstruction: `${getMemoryContext(messages)} ${researchContext}

              Your name is AI-assistant.
              You are a helpful AI assistant.
              Communicate in the user's language.
              Support English and Filipino.
              Be accurate, clear, and helpful.
              Never invent completed actions or information.
            `
          }
        });

        for await (const chunk of stream) {
          signal.throwIfAborted();

          if (!chunk.text) continue;

          if (!started) {
            started = true;
            onEvent({
              type: "model",
              model
            });
          }

          onEvent({
            type: "delta",
            text: chunk.text
          });
        }

        if (!started) {
          throw new Error("Empty AI response.");
        }

        onEvent({
          type: "done",
          model
        });

        return;

      } catch (error) {
        lastError = error;

        if (signal.aborted || started || !isRetryable(error)) {
          throw error;
        }

        if (Number(error.status) === 429) {
          break;
        }

        if (attempt === 0) {
          await new Promise(resolve =>
            setTimeout(resolve, 1500)
          );
        }
      }
    }
  }

  throw lastError || new Error("No AI model available.");
}








export async function streamResponse(
  messages,
  selection,
  signal,
  onEvent
) {
  signal.throwIfAborted();

  const query = getSearchQuery(messages);

  if (!query) {
    return generateStream(
      messages,
      selection,
      signal,
      onEvent
    );
  }

  const research = await prepareSearch(
    query,
    signal,
    onEvent
  );

  if (research.sources.length === 0) {
    onEvent({
      type: "delta",
      text: "Web search unavailable or no usable results found. Answering from existing knowledge.\n\n"
    });
  }

  const selectedModel = (
    selection === "auto" ||
    selection === "qwen2.5:1.5b"
  )
    ? "qwen2.5-coder:7b"
    : selection;

  console.log(
    "[SEARCH] Retrieved sources:",
    research.sources.length
  );

  return generateStream(
    messages,
    selectedModel,
    signal,
    event => {
      if (event.type === "done") {
        signal.throwIfAborted();

        const citations = formatSources(
          research.sources
        );

        if (citations) {
          onEvent({
            type: "delta",
            text: citations
          });
        }
      }

      onEvent(event);
    },
    research.context
  );
}
