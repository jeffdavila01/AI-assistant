import codingSearchRoutes from "./routes/codingSearch.js";
import codingRoutes from "./routes/coding.js";
import { getQueueStatus } from "./ai/requestQueue.js";
import searchRoutes from "./routes/search.js";
import memoryRoutes from "./routes/memory.js";
import "dotenv/config";
import express from "express";
import cors from "cors";
import chatRoutes from "./routes/chat.js";
import { startLocalCoordinator } from "./ai/coordinator.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:5174"
  ]
}));

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    name: "AI-assistant",
    version: "0.1.0",
    status: "Online"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    provider: "Gemini",
    apiConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL
  });
});

app.use("/api/search/coding", codingSearchRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/coding", codingRoutes);

app.get("/api/queue/status", (req, res) => {
  res.json(getQueueStatus());
});

app.use("/api/search", searchRoutes);
app.use("/api/memory", memoryRoutes);

await startLocalCoordinator();
app.listen(PORT, "127.0.0.1", () => {
  console.log("==============================");
  console.log(" AI-ASSISTANT SERVER ONLINE");
  console.log(` http://localhost:${PORT}`);
  console.log("==============================");
});




