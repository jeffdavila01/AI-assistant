export async function searchWikipedia(query, signal) {
  const url = new URL(
    "https://en.wikipedia.org/w/rest.php/v1/search/page"
  );

  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "LocalAI-Assistant/0.4.5"
    },
    signal: signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(15000)
        ])
      : AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      `Wikipedia HTTP ${response.status}`
    );
  }

  const data = await response.json();

  return (data.pages || []).map(page => ({
    provider: "Wikipedia",

    title: page.title,

    url: "https://en.wikipedia.org/wiki/" +
      encodeURIComponent(page.key),

    snippet: String(
      page.excerpt || page.description || ""
    ).replace(/<[^>]*>/g, "").slice(0, 800)
  }));
}
