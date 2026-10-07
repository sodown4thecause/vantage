import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const costs = vi.hoisted(() => ({ events: [] as Record<string, unknown>[] }));
vi.mock("@/lib/costs/ledger", () => ({ recordCost: async (event: Record<string, unknown>) => costs.events.push(event) }));
vi.mock("@/lib/costs/prices", () => ({ getUnitCost: async () => 0 }));

import { githubCollector } from "@/lib/collectors/github";
import { stackOverflowCollector } from "@/lib/collectors/stackoverflow";

const ctx = { workspaceId: "workspace", sourceId: "source", config: { query: "agent evaluation", includeReplies: false } };
beforeEach(() => { costs.events = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("public developer collectors", () => {
  it("normalizes GitHub issue identity, original dates and zero-cost attribution", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ total_count: 1, incomplete_results: false, items: [{
      id: 42, number: 7, html_url: "https://github.com/acme/agent/issues/7", title: "Evaluation fails",
      body: "Cannot compare agent runs", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-06T12:00:00Z",
      user: { login: "builder" }, comments: 3, labels: [{ name: "bug" }],
    }] })));
    const result = await githubCollector.run(ctx);
    expect(result.documents[0]).toMatchObject({ platform: "github", urlCanonical: "https://github.com/acme/agent/issues/7", postedAt: new Date("2026-10-01T12:00:00Z"), authorRef: "builder", contentMd: "Cannot compare agent runs", metadata: { provider: "github", issueId: 42, commentCount: 3, topReplies: [] } });
    expect(costs.events[0]).toMatchObject({ sourceKey: "source", workspaceId: "workspace", provider: "github", unitCostUsd: 0, ok: true });
  });

  it("caps GitHub pagination and requests public issues only", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); urls.push(url);
      return Response.json({ total_count: 1000, incomplete_results: false, items: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, html_url: `https://github.com/acme/agent/issues/${i + 1}`, title: "Agent", body: "Problem" })) });
    });
    const result = await githubCollector.run({ ...ctx, config: { query: "agent", maxPages: 50 } });
    expect(urls).toHaveLength(2);
    expect(urls[0]?.searchParams.get("q")).toContain("is:public is:issue");
    expect(result.documents).toHaveLength(30);
  });

  it("preserves a successful empty result without fixtures", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ total_count: 0, items: [] }));
    expect((await githubCollector.run(ctx)).documents).toEqual([]);
    vi.stubGlobal("fetch", async () => Response.json({ items: [], has_more: false, quota_remaining: 100 }));
    expect((await stackOverflowCollector.run(ctx)).documents).toEqual([]);
  });

  it("stops before a request when aborted and rejects rate-limited GitHub calls", async () => {
    const aborted = new AbortController(); aborted.abort();
    const request = vi.fn(async () => new Response(null, { status: 429 })); vi.stubGlobal("fetch", request);
    await expect(githubCollector.run({ ...ctx, signal: aborted.signal })).rejects.toThrow();
    await expect(stackOverflowCollector.run({ ...ctx, signal: aborted.signal })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    await expect(githubCollector.run(ctx)).rejects.toThrow(/rate.limit|429/i);
  });

  it("normalizes Stack Overflow bodies and never invents missing creation dates", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ has_more: false, quota_remaining: 100, items: [{ question_id: 101, link: "https://stackoverflow.com/questions/101/agent", title: "Agent &amp; eval", body: "<p>Need reproducible evaluation</p>", owner: { display_name: "Builder" }, tags: ["langchain"], answer_count: 2 }] }));
    const result = await stackOverflowCollector.run(ctx);
    expect(result.documents[0]).toMatchObject({ platform: "stackoverflow", urlCanonical: "https://stackoverflow.com/questions/101/agent", postedAt: null, contentMd: "<p>Need reproducible evaluation</p>", metadata: { provider: "stackexchange", questionId: 101, rulesUrl: "https://stackoverflow.com/help/ai-policy", topReplies: [] } });
  });

  it("persists Stack Exchange backoff and makes no extra pagination or reply calls", async () => {
    const request = vi.fn(async () => Response.json({ items: [], has_more: true, backoff: 60, quota_remaining: 100 })); vi.stubGlobal("fetch", request);
    const first = await stackOverflowCollector.run({ ...ctx, config: { query: "agent", maxPages: 2, includeReplies: true } });
    expect(request).toHaveBeenCalledTimes(1);
    await expect(stackOverflowCollector.run({ ...ctx, cursor: first.nextState?.cursor })).rejects.toThrow(/backoff/i);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("collects bounded existing Stack Overflow answers for contribution-gap research", async () => {
    vi.stubGlobal("fetch", async (input: string) => input.includes("/answers")
      ? Response.json({ items: [{ question_id: 101, answer_id: 201, body: "Use a fixed evaluation dataset", owner: { display_name: "Expert" }, score: 9 }], has_more: false })
      : Response.json({ items: [{ question_id: 101, link: "https://stackoverflow.com/questions/101/agent", title: "Agent evaluation", body: "How do I compare runs?" }], has_more: false }));
    const result = await stackOverflowCollector.run({ ...ctx, config: { query: "agent", includeReplies: true } });
    expect(result.documents[0]?.metadata).toMatchObject({ topReplies: [{ id: "201", text: "Use a fixed evaluation dataset", url: "https://stackoverflow.com/a/201" }] });
  });

  it("drops provider records with non-public or wrong-venue canonical URLs", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ total_count: 1, items: [{ id: 1, html_url: "http://127.0.0.1/secret", body: "bad" }] }));
    expect((await githubCollector.run(ctx)).documents).toEqual([]);
    vi.stubGlobal("fetch", async () => Response.json({ has_more: false, items: [{ question_id: 1, link: "https://example.com/questions/1", body: "bad" }] }));
    expect((await stackOverflowCollector.run(ctx)).documents).toEqual([]);
  });
});
