import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PRIVATE_PATHS } from "@/lib/seo";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Module specifiers of every static import and re-export in a source file. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]!);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const CLIENT_FILES = ["app/seo/chat-client.tsx", "app/seo/cards.tsx"];
const SPEND_FUNCTIONS = ["fetchBacklinkSummary", "fetchReferringDomains", "fetchAnchors", "runDataForSeo", "runAgent"];

describe("SEO page source contracts", () => {
  it("the page, chat client and cards never reference a spending function", () => {
    for (const file of ["app/seo/page.tsx", ...CLIENT_FILES]) {
      const source = read(file);
      for (const name of SPEND_FUNCTIONS) expect(source, `${file} mentions ${name}`).not.toContain(name);
    }
  });

  it("the chat client and cards import nothing server-side: no lib modules, db, gate or client", () => {
    for (const file of CLIENT_FILES) {
      const specifiers = importSpecifiers(read(file));
      expect(specifiers.filter((spec) => spec.startsWith("@/lib/")), file).toEqual([]);
      expect(specifiers.filter((spec) => /^@\/lib\/db(\/|$)/.test(spec)), file).toEqual([]);
      expect(specifiers.filter((spec) => /^@\/lib\/dataforseo\/(gate|client)$/.test(spec)), file).toEqual([]);
    }
  });

  it("the chat client is a client component", () => {
    expect(read("app/seo/chat-client.tsx").trimStart().startsWith('"use client"')).toBe(true);
  });

  it("app/seo/actions.ts is deleted", () => {
    expect(existsSync(join(ROOT, "app/seo/actions.ts"))).toBe(false);
  });

  it("only lib/dataforseo/gate.ts imports the DataForSEO client, scanning lib and app", () => {
    const importers = [...sourceFiles("lib"), ...sourceFiles("app")].filter((file) =>
      importSpecifiers(read(file)).some((spec) =>
        spec === "@/lib/dataforseo/client" || (file.startsWith("lib/dataforseo/") && spec === "./client"),
      ),
    );
    expect(importers).toEqual(["lib/dataforseo/gate.ts"]);
  });

  it("keeps the signed-in /seo page out of the index", () => {
    expect(PRIVATE_PATHS).toContain("/seo");
  });

  it("sets the page title, noindex and force-dynamic rendering", () => {
    const source = read("app/seo/page.tsx");
    expect(source).toContain('title: "SEO"');
    expect(source).toContain("robots: { index: false }");
    expect(source).toContain('export const dynamic = "force-dynamic"');
  });

  it("authorizes the workspace before it reads conversations or the profile", () => {
    const source = read("app/seo/page.tsx");
    const authorized = source.indexOf("authorizeWorkspace(workspaceId)");
    expect(authorized).toBeGreaterThan(-1);
    expect(authorized).toBeLessThan(source.indexOf("listConversations("));
    expect(authorized).toBeLessThan(source.indexOf("getLatestMonitoringProfile("));
  });
});

describe("result cards", () => {
  const loadCards = () => import("@/app/seo/cards");
  const render = async (card: Record<string, unknown>, sandbox = false) => {
    const { ResultCardView } = await loadCards();
    return renderToStaticMarkup(createElement(ResultCardView, { card: card as never, sandbox }));
  };
  const card = (tool: string, data: unknown, overrides: Record<string, unknown> = {}) => ({
    tool,
    title: `Title for ${tool}`,
    fetchedAt: "2026-10-19T10:00:00.000Z",
    cached: false,
    data,
    ...overrides,
  });

  it("renders a backlink summary as a captioned table with column headers", async () => {
    const html = await render(card("backlink_summary", {
      target: "acme.dev", rank: 1200, backlinks: 5000, referringDomains: 80, referringMainDomains: 60,
      brokenBacklinks: 3, spamScore: 4, firstSeen: "2020-01-01 00:00:00 +00:00",
    }));
    expect(html).toContain("<caption");
    expect(html).toContain('<th scope="col"');
    expect(html).toContain("Domain rank");
    expect(html).toContain("1,200");
    expect(html).toContain("2020-01-01");
  });

  it("renders referring domains with domain, rank, backlinks and first seen columns", async () => {
    const html = await render(card("referring_domains", [
      { domain: "blog.example.org", rank: 500, backlinks: 12, spamScore: 0, firstSeen: "2021-05-02T00:00:00Z" },
    ]));
    for (const header of ["Domain", "Rank", "Backlinks", "First seen"]) {
      expect(html).toContain(`<th scope="col"`);
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html).toContain("blog.example.org");
  });

  it("labels an empty anchor as (no anchor text)", async () => {
    const html = await render(card("anchors", [{ anchor: "", backlinks: 4, referringDomains: 2 }]));
    expect(html).toContain("(no anchor text)");
  });

  it("marks a cached card as Cached and a live card not", async () => {
    const cached = await render(card("keyword_ideas", [], { cached: true, fetchedAt: null }));
    const live = await render(card("keyword_ideas", []));
    expect(cached).toContain("Cached");
    expect(live).not.toContain("Cached");
  });

  it("shows the sandbox label only when the page says the data is sandbox data", async () => {
    const data = [{ keyword: "ci caching", searchVolume: 880, cpc: null, difficulty: 22, intent: "informational" }];
    expect(await render(card("keyword_overview", data), true)).toContain("Sandbox data: not real figures.");
    expect(await render(card("keyword_overview", data), false)).not.toContain("Sandbox data");
  });

  it("renders provider text as text, never as markup", async () => {
    const html = await render(card("referring_domains", [
      { domain: "<img src=x onerror=alert(1)>", rank: 1, backlinks: 1, spamScore: 0, firstSeen: null },
    ]));
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("links a citation only when its URL is http or https", async () => {
    const html = await render(card("llm_response", {
      engine: "chat_gpt", model: "gpt", text: "Answer.", mentionsBrand: true,
      citations: [
        { title: "Bad", url: "javascript:alert(1)" },
        { title: "Good", url: "https://example.com/guide" },
      ],
    }));
    expect(html).toContain('href="https://example.com/guide"');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("javascript:alert(1)");
  });

  it("renders every card tool without throwing", async () => {
    const samples: Record<string, unknown> = {
      backlink_summary: { target: "a.dev", rank: 1, backlinks: 1, referringDomains: 1, referringMainDomains: 1, brokenBacklinks: 0, spamScore: 0, firstSeen: null },
      referring_domains: [{ domain: "b.dev", rank: 1, backlinks: 1, spamScore: 0, firstSeen: null }],
      backlink_gap: [{ domain: "c.dev", rank: 1, backlinks: 1, spamScore: 0, firstSeen: null }],
      anchors: [{ anchor: "docs", backlinks: 1, referringDomains: 1 }],
      keyword_ideas: [{ keyword: "k", searchVolume: 1, cpc: null, difficulty: null, intent: null }],
      keyword_overview: [{ keyword: "k", searchVolume: 1, cpc: null, difficulty: null, intent: null }],
      ranked_keywords: [{ keyword: "k", searchVolume: 1, cpc: null, difficulty: null, intent: null, position: 3, url: "https://a.dev/x" }],
      competitor_domains: [{ domain: "d.dev", avgPosition: 4.5, intersections: 9 }],
      keyword_gap: [{ keyword: "k", searchVolume: 1, cpc: null, difficulty: null, intent: null, position: null, url: null }],
      google_serp: { organic: [{ position: 1, domain: "e.dev", title: "T", url: "https://e.dev" }], hasAiOverview: true, peopleAlsoAsk: ["Why?"] },
      llm_response: { engine: "claude", model: null, text: "Answer.", mentionsBrand: false, citations: [] },
      ai_keyword_volume: [{ keyword: "k", aiSearchVolume: 42 }],
    };
    for (const [tool, data] of Object.entries(samples)) {
      const html = await render(card(tool, data));
      expect(html, tool).toContain(`Title for ${tool}`);
    }
  });

  it("falls back to readable text for a tool it does not know", async () => {
    const html = await render(card("mystery_tool", { weird: [1, 2] }));
    expect(html).toContain("Title for mystery_tool");
    expect(html).toContain("weird");
  });
});

describe("chat client", () => {
  const WS = "11111111-1111-4111-8111-111111111111";
  const STARTERS = [
    { category: "seo", text: "Which keywords does acme.dev rank for?", costLabel: "~1 credit" },
    { category: "geo", text: "Does ChatGPT mention Acme when people ask?", costLabel: "Needs approval" },
    { category: "content", text: "What should our next post target?", costLabel: "Free" },
  ] as const;

  const renderChat = async (props: Partial<{ conversationId: string | null; initialMessages: unknown[]; starters: unknown[] }> = {}) => {
    const { ChatClient } = await import("@/app/seo/chat-client");
    return renderToStaticMarkup(createElement(ChatClient, {
      workspaceId: WS,
      conversationId: null,
      initialMessages: [],
      starters: [...STARTERS],
      sandbox: true,
      ...props,
    } as never));
  };

  it("shows the three starter chips in SEO, GEO, Content order, each a button with its label and cost", async () => {
    const html = await renderChat();
    const seo = html.indexOf('aria-label="SEO question: Which keywords does acme.dev rank for?"');
    const geo = html.indexOf('aria-label="GEO question: Does ChatGPT mention Acme when people ask?"');
    const content = html.indexOf('aria-label="Content question: What should our next post target?"');
    expect(seo).toBeGreaterThan(-1);
    expect(geo).toBeGreaterThan(seo);
    expect(content).toBeGreaterThan(geo);
    expect(html).toMatch(/<button[^>]*aria-label="SEO question: /);
    for (const label of ["~1 credit", "Needs approval", "Free"]) expect(html).toContain(label);
  });

  it("renders a saved answer from its stored parts, with follow-up chips and no cost labels on them", async () => {
    const html = await renderChat({
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      initialMessages: [
        { id: "m-1", role: "user", content: "Which keywords?", parts: {}, status: "complete", creditsUsed: 0, createdAt: "2026-10-19T10:00:00.000Z" },
        {
          id: "m-2", role: "assistant", content: "Acme ranks for twelve terms.", status: "complete", creditsUsed: 1, createdAt: "2026-10-19T10:00:01.000Z",
          parts: {
            cards: [{ tool: "ranked_keywords", title: "Ranked keywords — acme.dev", fetchedAt: null, cached: true, data: [] }],
            followUps: { seo: "Which keywords hold rank?", geo: "Does ChatGPT cite docs?", content: "Outline a comparison post." },
            notices: ["SEO data is not set up yet."],
          },
        },
      ],
    });
    expect(html).toContain("Acme ranks for twelve terms.");
    expect(html).toContain("Ranked keywords — acme.dev");
    expect(html).toContain("SEO data is not set up yet.");
    expect(html).toContain('aria-label="SEO question: Which keywords hold rank?"');
    expect(html).toContain('aria-label="Content question: Outline a comparison post."');
    expect(html).not.toContain('aria-label="SEO question: Which keywords does acme.dev rank for?"');
    expect(html).not.toContain("Needs approval");
    expect(html).not.toContain("~1 credit");
  });

  it("offers Run it and Cancel for a plan awaiting approval, with the total credits", async () => {
    const html = await renderChat({
      initialMessages: [
        {
          id: "m-9", role: "assistant", content: "I need approval for one lookup.", status: "needs_approval", creditsUsed: 0, createdAt: "2026-10-19T10:00:00.000Z",
          parts: { plan: [{ tool: "llm_response", input: { prompt: "Best CI cache?", engines: ["chat_gpt"] }, credits: 2 }] },
        },
      ],
    });
    expect(html).toMatch(/<button[^>]*>\s*Run it\s*<\/button>/);
    expect(html).toMatch(/<button[^>]*>\s*Cancel\s*<\/button>/);
    expect(html).toContain("2 credits");
  });

  it("renders an incomplete answer as a muted notice without approval controls", async () => {
    const html = await renderChat({
      initialMessages: [
        { id: "m-4", role: "assistant", content: "Something went wrong. Nothing was charged.", status: "incomplete", creditsUsed: 0, createdAt: "2026-10-19T10:00:00.000Z", parts: {} },
      ],
    });
    expect(html).toContain("Something went wrong. Nothing was charged.");
    expect(html).not.toMatch(/<button[^>]*>\s*Run it\s*<\/button>/);
  });
});
