import { searchWikipedia } from "./wikipedia.js";
import {
  searchStackOverflow
} from "./stackoverflow.js";

const cache = new Map();

const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE = 100;

const providers = {
  wikipedia: searchWikipedia,
  stackoverflow: searchStackOverflow
};

export async function searchWeb(
  query,
  mode = "auto",
  signal
) {
  query = String(query || "").trim();

  if (query.length < 2 || query.length > 300) {
    throw new Error(
      "Search query must contain 2-300 characters."
    );
  }

  if (![
    "auto",
    "coding",
    "general",
    "all"
  ].includes(mode)) {
    throw new Error("Invalid search mode.");
  }

  signal?.throwIfAborted();

  const key = `${mode}:${query.toLowerCase()}`;

  const cached = cache.get(key);

  if (
    cached &&
    Date.now() - cached.createdAt < CACHE_TTL
  ) {
    return {
      ...cached.data,
      cached: true
    };
  }

  const coding =
    /\b(javascript|typescript|python|react|node|npm|css|html|sql|api|error|debug|vite|next\.?js|supabase|git|github|code)\b/i
      .test(query);

  let selected;

  if (mode === "all") {
    selected = ["wikipedia", "stackoverflow"];
  } else if (mode === "coding") {
    selected = ["stackoverflow"];
  } else if (mode === "general") {
    selected = ["wikipedia"];
  } else {
    selected = coding
      ? ["stackoverflow"]
      : ["wikipedia"];
  }

  const responses = await Promise.allSettled(
    selected.map(provider =>
      providers[provider](query, signal)
    )
  );

  signal?.throwIfAborted();

  const results = [];
  const errors = [];

  responses.forEach((response, index) => {
    if (response.status === "fulfilled") {
      results.push(...response.value);
    } else {
      errors.push({
        provider: selected[index],
        error: response.reason?.message ||
          "Search failed."
      });
    }
  });

  const uniqueResults = [
    ...new Map(
      results.map(result => [
        result.url,
        result
      ])
    ).values()
  ];

  const data = {
    query,
    mode,
    providers: selected,
    success: errors.length < selected.length,
    searchedAt: new Date().toISOString(),
    cached: false,
    results: uniqueResults,
    errors
  };

  if (data.success && errors.length === 0) {
    if (cache.size >= MAX_CACHE) {
      cache.delete(
        cache.keys().next().value
      );
    }

    cache.set(key, {
      createdAt: Date.now(),
      data
    });
  }

  return data;
}
