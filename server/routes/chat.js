import { streamResponse } from "../ai/streaming.js";
import { MODELS } from "../ai/modelRouter.js";
import express from "express";
import { generateResponse } from "../ai/gemini.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { messages } = req.body;

    if (
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > 50 ||
      messages.some(m =>
        !m ||
        !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string" ||
        !m.content.trim() ||
        m.content.length > 20000
      )
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid messages."
      });
    }

    const reply = await generateResponse(messages);

    res.json({
      success: true,
      reply,
      model: process.env.GEMINI_MODEL
    });

  } catch (error) {
    console.error("AI error:", error.status || error.name);

    res.status(error.status === 429 ? 429 : 500).json({
      success: false,
      error: error.status === 429
        ? "AI usage limit reached."
        : "AI request failed.",
      providerStatus: error.status || null
    });
  }
});


router.get("/models", (req, res) => {
  res.json({
    success: true,
    models: MODELS
  });
});

router.post("/stream", async (req, res) => {
  const { messages, model = "auto" } = req.body || {};

  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 50 ||
    messages.some(m =>
      !m ||
      !["user", "assistant"].includes(m.role) ||
      typeof m.content !== "string" ||
      !m.content.trim() ||
      m.content.length > 20000
    )
  ) {
    return res.status(400).json({
      error: "Invalid messages."
    });
  }

  if (
    model !== "auto" &&
    !MODELS.some(item => item.id === model)
  ) {
    return res.status(400).json({
      error: "Unsupported model."
    });
  }

  const controller = new AbortController();

  res.on("close", () => {
    controller.abort();
  });

  res.setHeader(
    "Content-Type",
    "application/x-ndjson; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache, no-transform"
  );

  res.flushHeaders();

  const sendEvent = event => {
    if (!res.destroyed && !res.writableEnded) {
      res.write(JSON.stringify(event) + "\n");
    }
  };

  try {
    await streamResponse(
      messages,
      model,
      controller.signal,
      sendEvent
    );
  } catch (error) {
    console.error(
      "Streaming error:",
      error.status || error.name
    );

    sendEvent({
      type: "error",
      message: controller.signal.aborted
        ? "Generation stopped or timed out."
        : "AI response unavailable.",
      status: error.status || null
    });
  } finally {
    if (!res.destroyed) {
      res.end();
    }
  }
});


export default router;


