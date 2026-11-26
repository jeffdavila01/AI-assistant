import { Router } from "express";
import {
  searchWeb
} from "../tools/search/searchEngine.js";

const router = Router();

router.get("/", async (req, res) => {
  const query = typeof req.query.q === "string"
    ? req.query.q.trim()
    : "";

  const mode = req.query.mode || "auto";

  if (
    query.length < 2 ||
    query.length > 300
  ) {
    return res.status(400).json({
      error: "Search query must contain 2-300 characters."
    });
  }

  if (![
    "auto",
    "coding",
    "general",
    "all"
  ].includes(mode)) {
    return res.status(400).json({
      error: "Invalid search mode."
    });
  }

  const controller = new AbortController();

  const cancel = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };

  res.on("close", cancel);

  try {
    const result = await searchWeb(
      query,
      mode,
      controller.signal
    );

    if (!controller.signal.aborted) {
      res.status(
        result.success ? 200 : 503
      ).json(result);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      res.status(500).json({
        error: error.message
      });
    }
  } finally {
    res.off("close", cancel);
  }
});

export default router;
