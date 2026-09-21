import type { TinyFish } from "@tiny-fish/sdk";

import { createTinyFishClient } from "@/lib/tinyfish/client";

export type TinyFishSearchHit = {
  url: string;
  title: string;
  snippet: string;
  position: number;
};

export type TinyFishFetchedPage = {
  url: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  text: string;
  highlights: string[];
};

export async function tinyFishSearch(
  query: string,
  opts?: {
    includeDomains?: string[];
    purpose?: string;
    page?: number;
    client?: TinyFish;
  },
): Promise<TinyFishSearchHit[]> {
  const client = opts?.client ?? createTinyFishClient();
  const response = await client.search.query({
    query,
    purpose: opts?.purpose,
    include_domains: opts?.includeDomains?.join(",") || undefined,
    page: opts?.page,
  });
  return (response.results ?? [])
    .map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      position: r.position,
    }))
    .filter((r) => Boolean(r.url));
}

export async function tinyFishFetchMarkdown(
  urls: string[],
  opts?: {
    purpose?: string;
    highlightQuery?: string;
    client?: TinyFish;
  },
): Promise<TinyFishFetchedPage[]> {
  if (urls.length === 0) return [];
  const client = opts?.client ?? createTinyFishClient();
  // SDK batches; keep requests small and stable.
  const batchSize = 10;
  const pages: TinyFishFetchedPage[] = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const response = await client.fetch.getContents({
      urls: batch,
      format: "markdown",
      purpose: opts?.purpose,
      highlights: opts?.highlightQuery
        ? {
            query: opts.highlightQuery,
            max_snippets: 12,
            max_characters: 4000,
            include_full_page_text: true,
          }
        : undefined,
    });
for (const row of response.results ?? []) {
      const text =
        typeof row.text === "string"
          ? row.text
          : row.text != null
            ? JSON.stringify(row.text)
            : "";
const highlightRows = Array.isArray(
        (row as { highlights?: unknown }).highlights,
      )
        ? ((row as { highlights: Array<{ text?: string }> }).highlights ?? [])
        : [];
      pages.push({
        url: row.url,
        finalUrl: row.final_url || undefined,
        title: row.title || undefined,
        description: row.description || undefined,
        text,
        highlights: highlightRows
          .map((h: { text?: string }) =>
            typeof h?.text === "string" ? h.text : "",
          )
          .filter(Boolean),
      });
    }
  }
  return pages;
}
