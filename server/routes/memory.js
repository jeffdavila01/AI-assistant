import express from "express";

import {
  getMemory,
  saveMemory,
  updateMemory,
  deleteMemory,
  clearMemory,
  setMemoryEnabled
} from "../memory/store.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.json(getMemory());
});

router.post("/", (req, res) => {
  try {
    const memory = saveMemory(
      req.body?.content,
      req.body?.category
    );

    res.status(201).json({
      success: true,
      memory
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

router.patch("/settings", (req, res) => {
  try {
    const enabled = setMemoryEnabled(req.body?.enabled);

    res.json({
      success: true,
      enabled
    });
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

router.patch("/:id", (req, res) => {
  try {
    const memory = updateMemory(
      req.params.id,
      req.body?.content,
      req.body?.category
    );

    if (!memory) {
      return res.status(404).json({
        error: "Memory not found."
      });
    }

    res.json({
      success: true,
      memory
    });
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

router.delete("/all", (req, res) => {
  clearMemory();
  res.json({ success: true });
});

router.delete("/:id", (req, res) => {
  const deleted = deleteMemory(req.params.id);

  res.status(deleted ? 200 : 404).json({
    success: deleted
  });
});

export default router;
