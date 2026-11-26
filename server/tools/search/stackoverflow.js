let blockedUntil = 0;

function decodeText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchStackOverflow(
  query,
  signal
) {
  if (Date.now() < blockedUntil) {
    throw new Error(
      "Stack Overflow search is temporarily rate limited."
    );
  }

  const url = new URL(
    "https://api.stackexchange.com/2.3/search/advanced"
  );

  url.searchParams.set("site", "stackoverflow");
  url.searchParams.set("q", query);
  url.searchParams.set("order", "desc");
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("pagesize", "5");
  url.searchParams.set("filter", "withbody");

  const response = await fetch(url, {
    signal: signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(15000)
        ])
      : AbortSignal.timeout(15000)
  });

  if (response.status === 429) {
    blockedUntil = Date.now() + 60000;
  }

  if (!response.ok) {
    throw new Error(
      `Stack Overflow HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (data.backoff) {
    blockedUntil = Date.now() + data.backoff * 1000;
  }

  if (data.quota_remaining === 0) {
    blockedUntil = Math.max(
      blockedUntil,
      Date.now() + 86400000
    );
  }

  return (data.items || []).map(item => ({
    provider: "Stack Overflow",

    title: decodeText(item.title),

    url: item.link,

    snippet: decodeText(
      item.body || ""
    ).slice(0, 800),

    score: item.score,

    answered: item.is_answered,

    author: item.owner?.display_name || null,

    updatedAt: item.last_activity_date
      ? new Date(
          item.last_activity_date * 1000
        ).toISOString()
      : null
  }));
}
