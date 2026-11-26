export function isBasicFetchQuery(query) {
  return /^(?:(?:how to use|how do i use|explain|what is|using|use)\s+)?(?:javascript\s+)?fetch(?:\s+api)?(?:\s+in javascript)?[?.!]*$/i
    .test(String(query).trim());
}

export function optimizeMDNQuery(query) {
  if (isBasicFetchQuery(query)) {
    return "Fetch API";
  }

  return String(query).trim();
}

export function prioritizeSources(results, query) {
  if (!isBasicFetchQuery(query)) {
    return results;
  }

  function score(item) {
    const source = item.source || item.provider;
    const title = String(item.title || "").toLowerCase();

    if (source !== "MDN Web Docs") {
      return 0;
    }

    if (title === "using the fetch api") return 100;
    if (title === "fetch api") return 90;
    if (title.includes("fetch() method")) return 80;
    if (title.includes("fetch api")) return 70;

    return 0;
  }

  return [...results].sort(
    (a, b) => score(b) - score(a)
  );
}
