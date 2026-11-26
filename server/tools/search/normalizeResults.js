export function normalizeResults(results = [], query = "") {
  const keywords = String(query)
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];

  return results
    .filter(item => {
      try {
        return new URL(item.url).protocol === "https:";
      } catch {
        return false;
      }
    })
    .map(item => {
      const source =
        item.source ||
        item.provider ||
        "Unknown source";

      const title = String(
        item.title || "Untitled"
      );

      const description = String(
        item.description ||
        item.snippet ||
        ""
      );

      const lowerTitle = title.toLowerCase();

      const lowerDescription =
        description.toLowerCase();

      let relevance = 0;

      for (const keyword of keywords) {
        if (lowerTitle.includes(keyword)) {
          relevance += 5;
        }

        if (lowerDescription.includes(keyword)) {
          relevance += 1;
        }
      }

      if (source === "MDN Web Docs") {
        relevance += 2;
      }

      if (item.answered === true) {
        relevance += 1;
      }

      return {
        source,
        title,
        description,
        url: item.url,
        author: item.author || null,
        answered: item.answered ?? null,
        updatedAt: item.updatedAt || null,
        publishedAt: item.publishedAt || null,
        relevance
      };
    })
    .sort((a, b) => b.relevance - a.relevance);
}
