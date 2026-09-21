import fixture from "@/test/fixtures/producthunt.json";
import {
  asRecordArray,
  numberField,
  runTinyFishStructuredAgent,
  stringField,
} from "@/lib/tinyfish/agent";
import { hasTinyFishApiKey } from "@/lib/tinyfish/client";
import {
  tinyFishFetchMarkdown,
  tinyFishSearch,
} from "@/lib/tinyfish/search-fetch";

export type ProductHuntPost = {
  id: string;
  name: string;
  tagline: string;
  url: string;
  website?: string;
  votesCount: number;
  createdAt: string;
  description: string;
  topics: string[];
  maker?: string;
};

export type ProductHuntFetchMeta = {
  provider:
    | "tinyfish_search_fetch"
    | "tinyfish_fetch"
    | "tinyfish_agent"
    | "producthunt_api"
    | "fixture";
};

const POSTS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          tagline: { type: "string" },
          url: { type: "string" },
          website: { type: "string" },
          votesCount: { type: "number" },
          createdAt: { type: "string" },
          description: { type: "string" },
          topics: { type: "array", items: { type: "string" } },
          maker: { type: "string" },
        },
        required: ["id", "name", "tagline", "url"],
      },
    },
  },
  required: ["posts"],
} as const;

function fixturePosts(first?: number): ProductHuntPost[] {
  return (fixture.posts as ProductHuntPost[]).slice(0, first ?? 20);
}

function mapTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return (
          stringField(item as Record<string, unknown>, "name", "label") ?? ""
        );
      }
      return "";
    })
    .filter(Boolean);
}

function mapPosts(
  rows: Array<Record<string, unknown>>,
  first: number,
): ProductHuntPost[] {
  const out: ProductHuntPost[] = [];
  for (const row of rows) {
    const name = stringField(row, "name", "title");
    const url = stringField(row, "url", "permalink", "href");
    if (!name || !url) continue;
    const tagline =
      stringField(row, "tagline", "subtitle", "headline", "snippet") ?? name;
    const description =
      stringField(row, "description", "summary", "body", "text") ?? tagline;
    out.push({
      id:
        stringField(row, "id", "slug", "productId") ??
        `ph-${out.length + 1}`,
      name,
      tagline,
      url,
      website: stringField(row, "website", "homepage", "site"),
      votesCount:
        numberField(row, "votesCount", "votes_count", "votes", "upvotes") ??
        0,
      createdAt:
        stringField(row, "createdAt", "created_at", "launchedAt") ??
        new Date().toISOString(),
      description,
      topics: mapTopics(row.topics ?? row.tags),
      maker: stringField(row, "maker", "makerUsername", "author", "user"),
    });
    if (out.length >= first) break;
  }
  return out;
}

function postsFromSearchAndPages(
  hits: Array<{ url: string; title: string; snippet: string }>,
  pages: Array<{ url: string; finalUrl?: string; title?: string; text: string; description?: string }>,
  first: number,
): ProductHuntPost[] {
  const byUrl = new Map<string, ProductHuntPost>();
  for (const hit of hits) {
    if (!/producthunt\.com\/posts\//i.test(hit.url)) continue;
    const slug =
      hit.url.match(/producthunt\.com\/posts\/([^/?#]+)/i)?.[1] ??
      `ph-${byUrl.size + 1}`;
    byUrl.set(hit.url, {
      id: slug,
      name: hit.title || slug,
      tagline: hit.snippet || hit.title || slug,
      url: hit.url,
      votesCount: 0,
      createdAt: new Date().toISOString(),
      description: hit.snippet || hit.title || "",
      topics: [],
    });
  }
  for (const page of pages) {
    const url = page.finalUrl || page.url;
    if (!/producthunt\.com\/posts\//i.test(url) && !byUrl.has(page.url)) {
      // homepage/listing: try to harvest post links from markdown
      const linkRe =
        /\[([^\]]+)\]\((https?:\/\/www\.producthunt\.com\/posts\/[^)\s]+)\)/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(page.text)) && byUrl.size < first) {
        const name = m[1]?.trim();
        const href = m[2];
        if (!name || !href || byUrl.has(href)) continue;
        const slug =
          href.match(/producthunt\.com\/posts\/([^/?#]+)/i)?.[1] ??
          `ph-${byUrl.size + 1}`;
        byUrl.set(href, {
          id: slug,
          name,
          tagline: name,
          url: href,
          votesCount: 0,
          createdAt: new Date().toISOString(),
          description: name,
          topics: [],
        });
      }
      continue;
    }
    const existing = byUrl.get(url) || byUrl.get(page.url);
    const slug =
      url.match(/producthunt\.com\/posts\/([^/?#]+)/i)?.[1] ??
      existing?.id ??
      `ph-${byUrl.size + 1}`;
    const name = page.title || existing?.name || slug;
    const description =
      page.description ||
      existing?.description ||
      page.text.slice(0, 500) ||
      name;
    byUrl.set(url, {
      id: slug,
      name,
      tagline: existing?.tagline || page.description || name,
      url,
      website: existing?.website,
      votesCount: existing?.votesCount ?? 0,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      description,
      topics: existing?.topics ?? [],
      maker: existing?.maker,
    });
  }
  return [...byUrl.values()].slice(0, first);
}

async function fetchViaTinyFishSearchFetch(opts?: {
  first?: number;
  query?: string;
}): Promise<ProductHuntPost[]> {
  const first = opts?.first ?? 20;
  const query =
    opts?.query?.trim() ||
    "site:producthunt.com/posts launched today developer tools saas";
  const hits = await tinyFishSearch(query, {
    includeDomains: ["producthunt.com"],
    purpose: "Find Product Hunt post pages for launches and products.",
  });
  const postUrls = [
    ...new Set(
      hits
        .map((h) => h.url)
        .filter((u) => /producthunt\.com\/posts\//i.test(u)),
    ),
  ].slice(0, Math.min(first, 10));

  // Always fetch homepage as a listing supplement when few post URLs.
  const urls = postUrls.length
    ? postUrls
    : ["https://www.producthunt.com/", ...hits.map((h) => h.url).slice(0, 5)];

  const pages = await tinyFishFetchMarkdown(urls, {
    purpose:
      "Extract Product Hunt product name, tagline, description, votes, maker, topics.",
    highlightQuery: "product launch tagline upvotes maker topics",
  });
  return postsFromSearchAndPages(hits, pages, first);
}

async function fetchViaTinyFishHomepageFetch(opts?: {
  first?: number;
}): Promise<ProductHuntPost[]> {
  const first = opts?.first ?? 20;
  const pages = await tinyFishFetchMarkdown(
    ["https://www.producthunt.com/"],
    {
      purpose: "Extract featured Product Hunt launches and product cards.",
      highlightQuery: "product name tagline votes maker",
    },
  );
  return postsFromSearchAndPages([], pages, first);
}

async function fetchViaTinyFishAgent(opts?: {
  first?: number;
}): Promise<ProductHuntPost[]> {
  const first = opts?.first ?? 20;
  const result = await runTinyFishStructuredAgent({
    url: "https://www.producthunt.com/",
    browserProfile: "lite",
    goal: [
      "Browse Product Hunt and extract current featured / top posts.",
      `Collect up to ${first} products with name, tagline, URL, votes, maker, topics, description.`,
      "Do not invent products. Empty posts array if blocked.",
    ].join("\n"),
    outputSchema: POSTS_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    maxSteps: 50,
    maxDurationSeconds: 240,
  });
  return mapPosts(
    asRecordArray(result, ["posts", "products", "items", "results"]),
    first,
  );
}

async function fetchViaProductHuntApi(opts?: {
  first?: number;
}): Promise<ProductHuntPost[]> {
  const token = process.env.PH_DEV_TOKEN;
  if (!token?.trim()) throw new Error("PH_DEV_TOKEN is not configured");

  const query = `
    query Posts($first: Int!) {
      posts(first: $first, order: VOTES) {
        edges {
          node {
            id
            name
            tagline
            url
            website
            votesCount
            createdAt
            description
            topics { edges { node { name } } }
            user { username }
          }
        }
      }
    }
  `;
  const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      variables: { first: opts?.first ?? 20 },
    }),
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Product Hunt API ${res.status}`);
  const json = (await res.json()) as {
    data?: {
      posts?: {
        edges?: Array<{
          node: {
            id: string;
            name: string;
            tagline: string;
            url: string;
            website?: string;
            votesCount: number;
            createdAt: string;
            description?: string;
            topics?: { edges?: Array<{ node: { name: string } }> };
            user?: { username?: string };
          };
        }>;
      };
    };
  };
  return (json.data?.posts?.edges ?? []).map(({ node }) => ({
    id: node.id,
    name: node.name,
    tagline: node.tagline,
    url: node.url,
    website: node.website,
    votesCount: node.votesCount,
    createdAt: node.createdAt,
    description: node.description ?? node.tagline,
    topics: (node.topics?.edges ?? []).map((e) => e.node.name),
    maker: node.user?.username,
  }));
}

/**
 * Product Hunt client.
 * Prefer TinyFish Search + Fetch; agent only as last TinyFish resort.
 */
export async function fetchProductHuntPosts(opts?: {
  first?: number;
  query?: string;
}): Promise<ProductHuntPost[]> {
  const { posts } = await fetchProductHuntPostsWithMeta(opts);
  return posts;
}

export async function fetchProductHuntPostsWithMeta(opts?: {
  first?: number;
  query?: string;
}): Promise<{ posts: ProductHuntPost[]; meta: ProductHuntFetchMeta }> {
  const tryPath = async (
    provider: ProductHuntFetchMeta["provider"],
    fn: () => Promise<ProductHuntPost[]>,
  ) => {
    try {
      const posts = await fn();
      if (!posts.length) return null;
      return { posts, meta: { provider } as const };
    } catch (err) {
      console.warn(
        `[producthunt] ${provider} failed; trying next path`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  };

  if (hasTinyFishApiKey()) {
    const searchFetch = await tryPath("tinyfish_search_fetch", () =>
      fetchViaTinyFishSearchFetch(opts),
    );
    if (searchFetch) return searchFetch;

    const homepage = await tryPath("tinyfish_fetch", () =>
      fetchViaTinyFishHomepageFetch(opts),
    );
    if (homepage) return homepage;

    const agent = await tryPath("tinyfish_agent", () =>
      fetchViaTinyFishAgent(opts),
    );
    if (agent) return agent;
  }

  if (process.env.PH_DEV_TOKEN?.trim()) {
    const posts = await fetchViaProductHuntApi(opts);
    return { posts, meta: { provider: "producthunt_api" } };
  }

  return {
    posts: fixturePosts(opts?.first),
    meta: { provider: "fixture" },
  };
}
