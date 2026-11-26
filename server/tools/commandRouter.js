import {
  getMemory,
  saveMemory,
  updateMemory
} from "../memory/store.js";

function reply(text) {
  return {
    handled: true,
    text,
    model: "AI-assistant System"
  };
}

const namePattern = /^(?:my preferred name is|my name is|the user's preferred name is|ang pangalan ko ay|ang preferred name ko ay)\s+(.+)$/i;

export function handleCommand(messages) {
  const latest = messages.at(-1);

  if (!latest || latest.role !== "user") {
    return { handled: false };
  }

  const original = latest.content.trim();

  const text = original
    .toLowerCase()
    .replace(/[?!.,]+$/g, "")
    .trim();

  if (/^(hi|hello|hey)$/.test(text)) {
    return reply("Hello! How can I help you today?");
  }

  if (/^(kumusta|kamusta)$/.test(text)) {
    return reply("Kumusta! Paano kita matutulungan?");
  }

  const isNameQuestion =
    /^(what is my (current )?(preferred )?name|what's my (preferred )?name|do you remember my name|ano ang pangalan ko|anong pangalan ko|ano pangalan ko|ano ang preferred name ko|naaalala mo ba ang pangalan ko)$/.test(text);

  if (isNameQuestion) {
    const data = getMemory();

    if (!data.enabled) {
      return reply(
        "Persistent memory is disabled. I cannot use your saved preferred name."
      );
    }

    const names = data.memories
      .filter(item =>
        item.category === "profile" &&
        namePattern.test(item.content)
      )
      .sort((a, b) =>
        String(b.updatedAt || b.createdAt).localeCompare(
          String(a.updatedAt || a.createdAt)
        )
      );

    if (!names.length) {
      return reply(
        "I don't have a saved preferred name for you yet."
      );
    }

    const name = names[0].content
      .match(namePattern)[1]
      .replace(/[.!]+$/, "")
      .trim();

    return reply(
      `Your saved preferred name is ${name}.`
    );
  }

  const remember = original.match(
    /^(?:remember that|remember this:|tandaan mo na)\s+(.+)$/is
  );

  if (remember) {
    const data = getMemory();

    if (!data.enabled) {
      return reply(
        "Memory is disabled. Enable it in Personalization first."
      );
    }

    const content = remember[1].trim();

    if (/\b(password|api key|secret key|access token|credit card|private key)\b/i.test(content)) {
      return reply(
        "For your security, credentials should not be stored in memory."
      );
    }

    const nameMatch = content.match(namePattern);

    if (nameMatch) {
      const name = nameMatch[1]
        .replace(/[.!]+$/, "")
        .trim();

      const existing = data.memories.filter(item =>
        item.category === "profile" &&
        namePattern.test(item.content)
      );

      if (existing.length > 1) {
        return reply(
          "Multiple saved names found. Please resolve them in Personalization."
        );
      }

      const value = `My preferred name is ${name}.`;

      if (existing.length === 1) {
        updateMemory(existing[0].id, value, "profile");
      } else {
        saveMemory(value, "profile");
      }

      return reply(
        `Your preferred name, ${name}, has been saved.`
      );
    }

    saveMemory(content, "general");

    return reply(`Memory saved: ${content}`);
  }

  return { handled: false };
}
