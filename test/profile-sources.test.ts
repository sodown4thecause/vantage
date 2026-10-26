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
vi.mock("@/lib/sources/persist", async () => {
  const { PlanLimitError } = await import("@/lib/plans/types");
  return { PROFILE_SOURCE_NAME: "Profile: Hacker News", persistSourceWithinLimit: async (workspaceId: string, value: Record<string, unknown>, mergeConfig: boolean) => {
    const present = state.existing.some(row => row.name === value.name);
    if (!present && state.existing.length + 1 > state.limit) throw new PlanLimitError("sources", state.limit, "limit");
    if (!present) state.existing.push({ name: String(value.name) });
    state.values.push({ workspaceId, ...value }); state.conflicts.push(mergeConfig);
    return true;
  } };
});
import { keyedProfileSources, provisionProfileSources } from "@/lib/profile/repository";

beforeEach(() => {
  state.values = []; state.conflicts = []; state.existing = []; state.limit = 8;
  vi.stubEnv("TINYFISH_API_KEY", "");
  vi.stubEnv("SCAVIO_API_KEY", "");
  vi.stubEnv("FIRECRAWL_API_KEY", "");
});

it("provisions a bounded free HN source through the config-merge persistence seam", async () => {
  await provisionProfileSources("ws-1", ["agent evaluation", "benchmarks"]);
  expect(state.values[0]).toMatchObject({ workspaceId: "ws-1", type: "hn", lane: "free", config: {
    queries: ["agent evaluation", "benchmarks"], maxPages: 1, enrich: false,
  } });
  expect(state.conflicts).toHaveLength(1);
  expect(state.conflicts[0]).toBe(true);
});

describe("keyed profile sources", () => {
  const topics = ["social listening", "reddit lead generation", "buying intent", "brand mentions"];

  it("adds Reddit and forums & blogs when TinyFish is configured, excluding the owner's own site", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf-key");
    await provisionProfileSources("ws-1", topics, "https://www.contextfor.dev/pricing");
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
    await provisionProfileSources("ws-1", topics, "https://contextfor.dev");
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
    await provisionProfileSources("ws-1", topics, "https://contextfor.dev");
    expect(state.values.map(v => v.name)).toEqual(["Profile: Hacker News", "Profile: Reddit"]);
  });
});
