import { describe, expect, it } from "vitest";
import { discoveryPlanSchema, normaliseDiscoveryPlan } from "@/lib/agents/discovery/profile";
import { discoveryPlanToStrategyChange, groundSources } from "@/lib/agents/discovery/sources";
import { groundCompetitors } from "@/lib/agents/discovery/competitors";
import { groundKeywords } from "@/lib/agents/discovery/keywords";
import type { ResearchEvidence } from "@/lib/agents/discovery/types";

const evidence: ResearchEvidence[] = [{
  id: "11111111-1111-4111-8111-111111111111",
  url: "https://product.example.com/compare",
  retrievedAt: "2026-10-25T00:00:00.000Z",
  excerpt: "Example Product offers incident response and issue tracking for teams with reliability and security. It includes analytics, workflows, customer support, integrations, compliance, audit logs, cost controls, monitoring, alerts, dashboards, and recovery.",
  provider: "direct",
  contentKind: "full",
  status: "verified",
}, {
  id: "55555555-5555-4555-8555-555555555555",
  url: "https://news.ycombinator.com/item?id=42",
  retrievedAt: "2026-10-25T00:00:00.000Z",
  excerpt: "Ask HN: How do teams discuss incident response and reliability?",
  provider: "direct",
  contentKind: "full",
  status: "verified",
}];

const candidate = {
  profile: {
    productUrl: "https://product.example.com",
    productDescription: "Incident response and issue tracking for teams.",
    targetCustomer: "Teams with reliability and security.",
    evidenceIds: [evidence[0]!.id],
  },
  competitors: [
    { domain: "competitor.example", positioning: "Incident response platform", evidenceIds: [evidence[0]!.id] },
  ],
  keywords: [
    ...["incident response", "issue tracking", "analytics", "workflows", "customer support", "integrations", "compliance", "audit logs", "cost controls", "monitoring", "alerts", "dashboards", "reliability", "security", "recovery"]
      .map(term => ({ term, reason: `Teams need ${term}.`, evidenceIds: [evidence[0]!.id] })),
  ],
  sources: [{
    type: "hn",
    config: { query: "incident response", tag: undefined, subreddit: undefined },
    reason: "Discusses incident response.",
    evidenceIds: [evidence[1]!.id],
    sampleUrls: ["https://news.ycombinator.com/item?id=42"],
  }],
  unknowns: [],
};

describe("discovery proposal contracts", () => {
  it("uses a strict plan schema and returns a cited plan without accepting invented competitor identities", () => {
    expect(discoveryPlanSchema.safeParse({ ...candidate, unapproved: true }).success).toBe(false);
    const plan = normaliseDiscoveryPlan(candidate, evidence);
    expect(plan.profile.evidenceIds).toEqual([evidence[0]!.id]);
    expect(plan.competitors).toEqual([]);
    expect(plan.unknowns.join(" ")).toMatch(/competitor\.example.*not verified/i);
    expect(plan.sources[0]).toMatchObject({ type: "hn", sampleUrls: ["https://news.ycombinator.com/item?id=42"] });
  });

  it("rejects product claims contradicted by negation in the cited page", () => {
    const contradictory = [{ ...evidence[0]!, excerpt: "Acme offers no incident response for teams. Teams with reliability and security need help." }, evidence[1]!];
    expect(() => normaliseDiscoveryPlan({
      ...candidate,
      profile: { ...candidate.profile, productDescription: "Incident response for teams" },
    }, contradictory)).toThrow(/profile claims are not grounded/i);
  });

  it("rejects forged or non-verified evidence references instead of citing them", () => {
    expect(() => normaliseDiscoveryPlan({ ...candidate, profile: { ...candidate.profile, evidenceIds: ["22222222-2222-4222-8222-222222222222"] } }, evidence)).toThrow(/evidence/i);
    expect(() => normaliseDiscoveryPlan(candidate, [{ ...evidence[0]!, status: "partial", contentKind: "preview" }])).toThrow(/verified/i);
    const unsupportedSample = normaliseDiscoveryPlan({ ...candidate, sources: [{ ...candidate.sources[0]!, sampleUrls: ["https://invented.example/thread"] }] }, evidence);
    expect(unsupportedSample.sources).toEqual([]);
    expect(unsupportedSample.unknowns.join(" ")).toMatch(/full verified sample on that platform/i);
  });

  it("requires exact competitor host/domain boundaries and same-page identity plus positioning", () => {
    const candidate = { domain: "acme.com", positioning: "incident response", evidenceIds: [evidence[0]!.id, evidence[1]!.id] };
    const splitEvidence = [
      { ...evidence[0]!, url: "https://product.example.com/compare", excerpt: "Acme.com is a competitor." },
      { ...evidence[1]!, url: "https://research.example.com/notes", excerpt: "Acme offers incident response." },
    ];
    const split = groundCompetitors([candidate], splitEvidence, "https://product.example.com");
    expect(split.competitors).toEqual([]);
    expect(split.unknowns.join(" ")).toMatch(/acme\.com remains unknown/i);

    const substring = groundCompetitors([{ ...candidate, evidenceIds: [evidence[0]!.id] }], [{ ...evidence[0]!, excerpt: "notacme.com offers incident response." }], "https://product.example.com");
    expect(substring.competitors).toEqual([]);

    const singlePage = groundCompetitors([{ ...candidate, evidenceIds: [evidence[0]!.id] }], [{ ...evidence[0]!, url: "https://acme.com/", excerpt: "Acme provides incident response." }], "https://product.example.com");
    expect(singlePage.competitors).toHaveLength(1);
  });

  it("requires platform-shaped pages to corroborate HN, Reddit, Stack Overflow and GitHub samples", () => {
    const samples = [
      { type: "hn", url: "https://news.ycombinator.com/item?id=42", title: "Ask HN: incident response with 10 points and 4 comments" },
      { type: "reddit", url: "https://www.reddit.com/r/SaaS/comments/abc123/incident_response/", title: "Reddit r/SaaS: incident response with 8 upvotes and 4 comments" },
      { type: "stackoverflow", url: "https://stackoverflow.com/questions/123/incident-response", title: "Stack Overflow incident response question with 3 answers" },
      { type: "github", url: "https://github.com/example/repo/issues/12", title: "GitHub issue about incident response, opened with 2 comments" },
    ] as const;
    const uncorroborated = samples.map((sample, index) => ({
      ...evidence[0]!, id: `88888888-8888-4888-8888-${String(index + 1).padStart(12, "0")}`,
      url: sample.url, excerpt: "An incident response product overview, unrelated to any discussion platform.",
    }));
    const rejected = groundSources(samples.map((sample, index) => ({
      type: sample.type, config: { query: "incident response" }, reason: "Evidence-based source proposal.",
      evidenceIds: [uncorroborated[index]!.id], sampleUrls: [sample.url],
    })), uncorroborated);
    expect(rejected.sources).toEqual([]);

    const corroborated = samples.map((sample, index) => ({
      ...evidence[0]!, id: `99999999-9999-4999-8999-${String(index + 1).padStart(12, "0")}`,
      url: sample.url, excerpt: sample.title,
    }));
    const accepted = groundSources(samples.map((sample, index) => ({
      type: sample.type, config: { query: "incident response" }, reason: "Evidence-based source proposal.",
      evidenceIds: [corroborated[index]!.id], sampleUrls: [sample.url],
    })), corroborated);
    expect(accepted.sources.map(item => item.type)).toEqual(["hn", "reddit", "stackoverflow", "github"]);
  });

  it("accepts forum/blog samples only when platform markers occur in the exact cited page", () => {
    const base = { config: { query: "incident response" }, reason: "Researches incident response.", evidenceIds: [evidence[0]!.id] };
    const arbitrary = groundSources([
      { ...base, type: "forums", sampleUrls: [evidence[0]!.url] },
      { ...base, type: "blogs", sampleUrls: [evidence[0]!.url] },
    ], [evidence[0]!]);
    expect(arbitrary.sources).toEqual([]);
    expect(arbitrary.unknowns).toHaveLength(2);

    const forumEvidence = { ...evidence[0]!, url: "https://community.example.com/forums/incident-response/42", excerpt: "Forum thread about incident response with three replies." };
    const blogEvidence = { ...evidence[0]!, id: "77777777-7777-4777-8777-777777777777", url: "https://publication.example.com/blog/incident-response", excerpt: "Blog article about incident response, published by an editor." };
    const grounded = groundSources([
      { ...base, type: "forums", evidenceIds: [forumEvidence.id], sampleUrls: [forumEvidence.url] },
      { ...base, type: "blogs", evidenceIds: [blogEvidence.id], sampleUrls: [blogEvidence.url] },
    ], [forumEvidence, blogEvidence]);
    expect(grounded.sources.map(item => item.type)).toEqual(["forums", "blogs"]);
  });

  it("caps proposals at the supported twelve keywords and makes remaining coverage explicit", () => {
    const plan = normaliseDiscoveryPlan(candidate, evidence);
    expect(plan.keywords).toHaveLength(12);
    expect(plan.unknowns.join(" ")).toMatch(/3 additional grounded keyword/i);
    const short = groundKeywords(candidate.keywords.slice(0, 4), evidence);
    expect(short.unknowns.join(" ")).toMatch(/below the 10-keyword target/i);
  });

  it("turns a grounded source plan plus an owner-requested exclusion into a proposal payload only", () => {
    const plan = normaliseDiscoveryPlan(candidate, evidence);
    const change = discoveryPlanToStrategyChange(plan, { currentProfile: null, exclusions: ["hiring posts"] });
    expect(change).toMatchObject({ exclusions: ["hiring posts"], profile: { productUrl: "https://product.example.com" }, sources: [{ type: "hn", enabled: false }] });
    expect(change.profile?.topics).toEqual(plan.keywords.map(item => item.term));
    expect(change.profile).not.toHaveProperty("competitors");
    expect(change).not.toHaveProperty("keywords");
  });
});
