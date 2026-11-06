import { describe, expect, it } from "vitest";

import { documentIsRelevant, flagNoisySources, reviewIngestedDocuments, type ReviewDoc } from "@/lib/agents/review";
import type { ReviewProfile } from "@/lib/agents/discovery";
import { sourceProposal } from "@/lib/db/schema";
import { fakeDb } from "./helpers/fake-db";

const WS = "11111111-1111-4111-8111-111111111111";
const profile: ReviewProfile = {
  productName: "Vantage", description: "Finds the conversations where developers ask for tools like yours.", category: "Go-to-market tooling for AI developer products",
  audience: "Founders of AI developer tools", differentiators: [], competitors: ["syften.com"], keywords: ["developer tool marketing"],
};
const relevant: ReviewDoc = { title: "Syften alternative for developer tool marketing?", text: "Looking for something to find buying-intent threads." };
const noise: ReviewDoc = { title: "Show HN: A Rust borrow checker visualiser", text: "I built a small viewer for lifetimes." };

describe("documentIsRelevant", () => {
  it("is true when the document names something specific to the product", () => {
    expect(documentIsRelevant(profile, relevant)).toBe(true);
    expect(documentIsRelevant(profile, noise)).toBe(false);
  });
  it("is not fooled by generic words alone", () => {
    expect(documentIsRelevant(profile, { title: "New AI tools and startup news", text: "Best software platform for your business" })).toBe(false);
  });
});

describe("flagNoisySources", () => {
  const many = (doc: ReviewDoc, n: number) => Array.from({ length: n }, () => doc);

  it("flags a source whose recent documents are mostly irrelevant (the 25 Oct HN case: 12 of 12)", () => {
    const flagged = flagNoisySources(profile, [{ id: "s1", name: "Profile: Hacker News", type: "hn", docs: many(noise, 12) }]);
    expect(flagged).toEqual([{ sourceId: "s1", name: "Profile: Hacker News", type: "hn", total: 12, irrelevant: 12 }]);
  });

  it("leaves a source alone when too few documents to judge, or when enough are relevant", () => {
    expect(flagNoisySources(profile, [{ id: "s1", name: "few", type: "hn", docs: many(noise, 4) }])).toEqual([]);
    expect(flagNoisySources(profile, [{ id: "s2", name: "mixed", type: "hn", docs: [...many(noise, 4), ...many(relevant, 6)] }])).toEqual([]);
  });
});

describe("reviewIngestedDocuments", () => {
  const sources = [{ id: "s1", name: "Profile: Hacker News", type: "hn", health: "healthy" }, { id: "s2", name: "Paused one", type: "hn", health: "paused" }];
  const docs = Array.from({ length: 12 }, (_, i) => ({ sourceId: "s1", title: noise.title, contentMd: `${noise.text} ${i}` }));
  const latestProfile = [{ productUrl: "https://contextfor.dev/", productDescription: profile.description, targetCustomer: profile.audience, topics: profile.keywords, competitors: profile.competitors }];

  it("proposes removal for a noisy source, scoped to the workspace, and never deletes or pauses it itself", async () => {
    const { db, ops } = fakeDb([latestProfile, [], [], sources, docs]);
    const result = await reviewIngestedDocuments(WS, { db, readSpent: async () => 0, env: {}, now: new Date("2026-10-26T04:00:00Z") });
    expect(result).toMatchObject({ checked: 1, flagged: ["Profile: Hacker News"] });
    const insert = ops.find((op) => op.kind === "insert" && op.table === sourceProposal)!;
    expect(insert.values).toMatchObject({ workspaceId: WS, action: "remove", sourceId: "s1", name: "Profile: Hacker News", status: "removal_proposed", accepted: false });
    expect((insert.values as { rationale: string }).rationale).toMatch(/12 of the last 12/);
    expect(ops.filter((op) => op.kind === "delete" || (op.kind === "update"))).toHaveLength(0);
    for (const op of ops.filter((o) => o.kind === "select" && o.where)) expect(op.where!.params).toContain(WS);
  });

  it("does nothing when the review budget for the day is used up", async () => {
    const { db, ops } = fakeDb([]);
    const result = await reviewIngestedDocuments(WS, { db, readSpent: async () => 0.05, env: {} });
    expect(result).toEqual({ checked: 0, flagged: [], skipped: "budget" });
    expect(ops).toHaveLength(0);
  });

  it("does nothing until the owner has a confirmed profile to judge against", async () => {
    const { db, ops } = fakeDb([[]]);
    const result = await reviewIngestedDocuments(WS, { db, readSpent: async () => 0, env: {} });
    expect(result).toEqual({ checked: 0, flagged: [], skipped: "no_profile" });
    expect(ops.filter((op) => op.kind === "insert")).toHaveLength(0);
  });
});
