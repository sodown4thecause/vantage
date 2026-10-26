import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: [] as Record<string, unknown>[], conflicts: [] as unknown[], existing: [] as { name: string }[], limit: 8,
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  insert: () => ({
    values: (value: Record<string, unknown>) => ({ onConflictDoUpdate: async (conflict: unknown) => {
      state.values.push(value); state.conflicts.push(conflict);
    } }),
  }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => state.existing }) }) }),
}) }));
vi.mock("@/lib/plans/limits", async () => {
  const { PlanLimitError } = await import("@/lib/plans/types");
  return { assertWithinCount: async (_ws: string, key: "sources", current: number) => {
    if (current + 1 > state.limit) throw new PlanLimitError(key, state.limit, "limit");
  } };
});
import { keyedProfileSources, provisionProfileSources } from "@/lib/profile/repository";
import type { RelevanceJudge } from "@/lib/agents/discovery";
import { memoryBudgetStore } from "./helpers/budget-store";

beforeEach(() => {
  state.values = []; state.conflicts = []; state.existing = []; state.limit = 8;
  vi.stubEnv("TINYFISH_API_KEY", "");
  vi.stubEnv("SCAVIO_API_KEY", "");
  vi.stubEnv("FIRECRAWL_API_KEY", "");
});

it("provisions a bounded free HN source using the existing duplicate constraint", async () => {
  await provisionProfileSources("ws-1", ["agent evaluation", "benchmarks"], undefined, "", { profile: { productDescription: "Agent evaluation and benchmarks for AI teams.", targetCustomer: "ML engineers", competitors: [] } });
  expect(state.values[0]).toMatchObject({ workspaceId: "ws-1", type: "hn", lane: "free", config: {
    queries: ["agent evaluation", "benchmarks"], maxPages: 1, enrich: false,
  } });
  expect(state.conflicts).toHaveLength(1);
  expect(state.conflicts[0]).toHaveProperty("target");
});

const LISTENING = { productDescription: "Social listening and Reddit lead generation: finds buying intent and brand mentions.", targetCustomer: "Founders", competitors: [] };

describe("keyed profile sources", () => {
  const topics = ["social listening", "reddit lead generation", "buying intent", "brand mentions"];

  it("adds Reddit and forums & blogs when TinyFish is configured, excluding the owner's own site", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf-key");
    await provisionProfileSources("ws-1", topics, "https://www.contextfor.dev/pricing", "", { profile: LISTENING });
    expect(state.values.map(v => v.name)).toEqual(["Profile: Hacker News", "Profile: Reddit", "Profile: Dev forums & blogs"]);
    expect(state.values[1]).toMatchObject({ type: "reddit", lane: "byok", config: { queries: topics.slice(0, 3), limit: 10 } });
    expect(state.values[2]).toMatchObject({ type: "web_search", lane: "byok", config: {
      provider: "tinyfish-web", queries: topics.slice(0, 3), kinds: ["forum", "blog"], excludeHosts: ["contextfor.dev"],
      forumDomains: ["community.hubspot.com", "warriorforum.com", "webmasterworld.com", "indiehackers.com"],
    } });
  });

  it("picks forum packs from the profile text as well as the topics", () => {
    const [web] = keyedProfileSources(["launch week"], undefined, { FIRECRAWL_API_KEY: "fc" }, "We help Shopify store owners");
    expect(web).toMatchObject({ name: "Profile: Dev forums & blogs", config: {
      forumDomains: ["community.shopify.com", "indiehackers.com"],
    } });
  });

  it("adds nothing keyed when no provider can serve it", async () => {
    await provisionProfileSources("ws-1", topics, "https://contextfor.dev", "", { profile: LISTENING });
    expect(state.values.map(v => v.name)).toEqual(["Profile: Hacker News"]);
  });

  it("uses Firecrawl alone for forums & blogs and Scavio alone for Reddit", () => {
    expect(keyedProfileSources(topics, undefined, { FIRECRAWL_API_KEY: "fc" }).map(s => s.name)).toEqual(["Profile: Dev forums & blogs"]);
    expect(keyedProfileSources(topics, undefined, { SCAVIO_API_KEY: "sc" }).map(s => s.name)).toEqual(["Profile: Reddit"]);
    expect(keyedProfileSources([], undefined, { TINYFISH_API_KEY: "tf" })).toEqual([]);
  });

  it("never pushes a workspace past its source limit, but still refreshes sources it already has", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf-key");
    state.limit = 8;
    state.existing = [{ name: "Profile: Hacker News" }, { name: "Profile: Reddit" },
      ...Array.from({ length: 6 }, (_, i) => ({ name: `Other ${i}` }))];
    await provisionProfileSources("ws-1", topics, "https://contextfor.dev", "", { profile: LISTENING });
    expect(state.values.map(v => v.name)).toEqual(["Profile: Hacker News", "Profile: Reddit"]);
  });
});

describe("the form flow goes through the same relevance gate (25 Oct regression)", () => {
  const profile = { productDescription: "Finds buying-intent conversations for AI developer tools.", targetCustomer: "Founders of AI dev tools", competitors: ["syften.com"] };
  const judgeSaying = (fit: number) => vi.fn<RelevanceJudge>(async (_profile, source) => ({
    judgements: source.queries.map((query) => ({ query, fit, rung: 3, situation: "other", why: "mock verdict" })), costUsd: 0.004,
  }));
  const NOW = new Date("2026-10-26T10:00:00Z");
  const gate = (judge?: RelevanceJudge, committed = 0) => ({ judge, store: memoryBudgetStore(committed ? { "ws-1|day:2026-10-26": committed } : {}).store, env: {}, now: NOW });

  it("REGRESSION: broad topics create no sources at all, and never reach the reviewer", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf-key");
    const judge = judgeSaying(0.99);
    await provisionProfileSources("ws-1", ["ai", "startup", "tools"], "https://contextfor.dev", "", { profile, gate: gate(judge) });
    expect(state.values).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("creates no sources when the review finds the topics do not fit the product", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf-key");
    const judge = judgeSaying(0.05);
    await provisionProfileSources("ws-1", ["buying intent poetry", "developer gardening"], "https://contextfor.dev", "", { profile, gate: gate(judge) });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(state.values).toEqual([]);
  });

  it("creates the sources when the review approves the topics", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf-key");
    await provisionProfileSources("ws-1", ["syften alternative", "buying intent"], "https://contextfor.dev", "", { profile, gate: gate(judgeSaying(0.9)) });
    expect(state.values.map((v) => v.name)).toEqual(["Profile: Hacker News", "Profile: Reddit", "Profile: Dev forums & blogs"]);
  });

  it("falls back to the term match when the discovery budget is spent, still refusing broad topics", async () => {
    const judge = judgeSaying(0.9);
    await provisionProfileSources("ws-1", ["syften alternative"], undefined, "", { profile, gate: gate(judge, 0.04) });
    expect(judge).not.toHaveBeenCalled();
    expect(state.values.map((v) => v.name)).toEqual(["Profile: Hacker News"]);

    state.values = [];
    await provisionProfileSources("ws-1", ["ai", "tools"], undefined, "", { profile, gate: gate(judge, 0.04) });
    expect(state.values).toEqual([]);
  });

  it("settles the review's cost against the workspace budget", async () => {
    const budget = memoryBudgetStore();
    await provisionProfileSources("ws-1", ["syften alternative"], undefined, "", { profile, gate: { judge: judgeSaying(0.9), store: budget.store, env: {}, now: NOW } });
    // Profile saves draw on the small daily review pool, never on the one-time initial discovery budget.
    expect(budget.get("ws-1", "day:2026-10-26")).toBeCloseTo(0.004, 6);
    expect(budget.get("ws-1", "initial")).toBe(0);
  });

  it("REGRESSION: topics that only echo themselves are not enough, even with no reviewer available", async () => {
    // "launch" and "week" are not generic words, but nothing in the product's own description or audience mentions them.
    await provisionProfileSources("ws-1", ["launch week", "product hunt"], "https://contextfor.dev", "", { profile, gate: gate(undefined) });
    expect(state.values).toEqual([]);
  });

  it("fails closed, creating nothing, when the budget store itself errors", async () => {
    const store = { committed: async () => { throw new Error("db down"); }, reserve: async () => true, settle: async () => undefined };
    await provisionProfileSources("ws-1", ["syften alternative"], undefined, "", { profile, gate: { judge: judgeSaying(0.9), store, env: {}, now: NOW } });
    expect(state.values).toEqual([]);
  });

  it("charges the estimate against the budget when the review fails after it started", async () => {
    const budget = memoryBudgetStore();
    const failing: RelevanceJudge = async () => { throw new Error("malformed output"); };
    await provisionProfileSources("ws-1", ["syften alternative"], undefined, "", { profile, gate: { judge: failing, store: budget.store, env: {}, now: NOW } });
    expect(budget.get("ws-1", "day:2026-10-26")).toBeCloseTo(0.01, 6);
  });
});
