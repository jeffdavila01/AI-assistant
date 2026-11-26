import { getMemoryContext } from "../memory/store.js";
import { GoogleGenAI } from "@google/genai";

export async function generateResponse(messages) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: messages.map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    })),
    config: {
      systemInstruction: `${getMemoryContext(messages)}

        Your name is AI-assistant.
        You are a helpful, intelligent AI assistant.
        Communicate naturally in English and Filipino.
        Assist with coding, research, education,
        productivity, and problem solving.
        Provide accurate and well-structured answers.
        Be transparent about your limitations.
        Never invent information or completed actions.
      `
    }
  });

  if (!response.text) {
    throw new Error("No text response received");
  }

  return response.text;
}

