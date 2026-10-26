import { describe, expect, it } from "vitest";

import { saveDiscoveryProposals, type DiscoveryOutcome } from "@/lib/agents/discovery";
import { competitor, keywordRecommendation, proposedProfile, sourceProposal } from "@/lib/db/schema";
import { fakeDb } from "./helpers/fake-db";

const WS = "11111111-1111-4111-8111-111111111111";
const outcome: DiscoveryOutcome = {
  status: "complete", modelCostUsd: 0.01, toolSpendUsd: 0.002, results: [],
  profile: {
    productName: "Vantage", description: "Finds conversations.", category: "GTM tooling", audience: "Founders", pricingTier: "paid",
    differentiators: ["Owner writes every reply"], evidenceUrl: "https://contextfor.dev/",
  },
  competitors: [{ domain: "syften.com", positioning: "Reddit alerts.", evidenceUrl: "https://syften.com/" }],
  keywords: [{ keyword: "Syften Alternative", kind: "competitor", rationale: "Buyers compare.", evidenceUrl: "https://syften.com/" }],
  sources: [
    { proposal: { sourceType: "hn", name: "HN: syften alternative", queries: ["syften alternative"], rationale: "r", relevanceScore: 0.8 },
      review: { accepted: true, score: 0.92, threshold: 0.5, matchedTerms: ["syften"], reasons: ["1 of 1 queries match the product profile."] } },
    { proposal: { sourceType: "hn", name: "Profile: Hacker News", queries: ["ai", "startup"], rationale: "r", relevanceScore: 0.9 },
      review: { accepted: false, score: 0.36, threshold: 0.5, matchedTerms: [], reasons: ["Every query is generic and could match almost any product."] } },
  ],
};

describe("saveDiscoveryProposals", () => {
  it("stores every proposal as proposed or reviewed, scoped to the workspace, and never as accepted", async () => {
    const { db, ops } = fakeDb();
    await saveDiscoveryProposals({ workspaceId: WS, productUrl: "https://contextfor.dev/", outcome }, db);

    const inserts = ops.filter((op) => op.kind === "insert");
    const byTable = (table: unknown) => inserts.filter((op) => op.table === table);
    expect(byTable(proposedProfile)).toHaveLength(1);
    expect(byTable(competitor)).toHaveLength(1);
    expect(byTable(keywordRecommendation)).toHaveLength(1);
    // Sources go in as one bulk insert holding both rows: the accepted one and the rejected one.
    expect(byTable(sourceProposal)).toHaveLength(1);
    expect(byTable(sourceProposal)[0]!.values).toHaveLength(2);

    for (const op of inserts) {
      const rows = Array.isArray(op.values) ? op.values : [op.values];
      for (const row of rows as Array<Record<string, unknown>>) {
        expect(row.workspaceId).toBe(WS);
        if ("status" in row) expect(row.status).not.toBe("accepted");
      }
    }
    expect((byTable(keywordRecommendation)[0]!.values as Array<Record<string, unknown>>)[0]!.keyword).toBe("syften alternative");
  });

  it("keeps the rejected HN profile source on record with its reasons, and marks it rejected", async () => {
    const { db, ops } = fakeDb();
    await saveDiscoveryProposals({ workspaceId: WS, productUrl: "https://contextfor.dev/", outcome }, db);
    const rows = ops.filter((op) => op.kind === "insert" && op.table === sourceProposal).flatMap((op) => op.values as Array<Record<string, unknown>>);
    const hn = rows.find((row) => row.name === "Profile: Hacker News")!;
    expect(hn).toMatchObject({ accepted: false, status: "rejected", action: "add" });
    expect(hn.reviewReasons).toEqual(["Every query is generic and could match almost any product."]);
    expect(rows.find((row) => row.name === "HN: syften alternative")).toMatchObject({ accepted: true, status: "reviewed" });
  });

  it("supersedes earlier unconfirmed profiles for the same workspace only", async () => {
    const { db, ops } = fakeDb();
    await saveDiscoveryProposals({ workspaceId: WS, productUrl: "https://contextfor.dev/", outcome }, db);
    const update = ops.find((op) => op.kind === "update" && op.table === proposedProfile)!;
    expect(update.set).toMatchObject({ status: "rejected" });
    expect(update.where!.params).toContain(WS);
    expect(update.where!.sql).toMatch(/workspace_id/);
  });

  it("writes nothing for a run that proposed nothing", async () => {
    const { db, ops } = fakeDb();
    await saveDiscoveryProposals({ workspaceId: WS, productUrl: "https://contextfor.dev/", outcome: { ...outcome, profile: undefined, competitors: [], keywords: [], sources: [] } }, db);
    expect(ops).toHaveLength(0);
  });
});
