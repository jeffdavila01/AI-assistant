import { normalizeResults } from "./normalizeResults.js";
import { searchMDN } from "./mdn.js";
import { searchStackOverflow } from "./stackoverflow.js";

const cache = new Map();

const CACHE_DURATION = 5 * 60 * 1000;
const CACHE_LIMIT = 100;

export async function searchCoding(query, signal) {
  const cleanQuery = String(query || "").trim();

  if (!cleanQuery || cleanQuery.length > 300) {
    throw new Error("Invalid coding search query.");
  }

  const key = cleanQuery.toLowerCase();

  const cached = cache.get(key);

  if (
    cached &&
    Date.now() - cached.createdAt < CACHE_DURATION
  ) {
    return {
      ...cached.data,
      cached: true
    };
  }

  const providers = [
    {
      name: "MDN",
      search: searchMDN
    },
    {
      name: "Stack Overflow",
      search: searchStackOverflow
    }
  ];

  const responses = await Promise.allSettled(
    providers.map(provider =>
      provider.search(cleanQuery, signal)
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
        provider: providers[index].name,
        message:
          response.reason?.message ||
          "Search failed."
      });
    }
  });

  const unique = [
    ...new Map(
      results.map(result => [
        result.url,
        result
      ])
    ).values()
  ];

  const data = {
    query: cleanQuery,
    searchedAt: new Date().toISOString(),
    total: unique.length,
    results: normalizeResults(unique, cleanQuery),
    errors,
    cached: false
  };

  if (errors.length === 0) {
    if (cache.size >= CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }

    cache.set(key, {
      createdAt: Date.now(),
      data
    });
  }

  return data;
}
