import { optimizeMDNQuery } from "./queryOptimizer.js";
export async function searchMDN(query, signal) {
  const url = new URL(
    "https://developer.mozilla.org/api/v1/search"
  );

  url.searchParams.set("q", optimizeMDNQuery(query));
  url.searchParams.set("locale", "en-US");

  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      `MDN search failed: ${response.status}`
    );
  }

  const data = await response.json();

  return (data.documents || [])
    .slice(0, 5)
    .map(document => ({
      source: "MDN Web Docs",
      title: document.title,
      description: document.summary || "",
      url: new URL(
        document.mdn_url,
        "https://developer.mozilla.org"
      ).href
    }));
}
