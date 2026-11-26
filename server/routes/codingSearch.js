import express from "express";
import { searchCoding } from "../tools/search/codingSearchEngine.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (!query || query.length > 300) {
    return res.status(400).json({
      error: "Invalid search query."
    });
  }

  try {
    const result = await searchCoding(query);

    const status =
      result.errors.length === 2 ? 502 : 200;

    res.status(status).json(result);

  } catch (error) {
    res.status(502).json({
      error: error.message
    });
  }
});

export default router;
