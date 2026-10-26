import { describe, expect, it } from "vitest";
import { strategyChangeSchema, proposalDecisionSchema, resolveProfileChange, resolveSourceChange } from "@/lib/gtm/proposals/types";

const profile = { productUrl: "https://example.com", docsUrls: [], productDescription: "Product", targetCustomer: "Founders", competitors: ["A", "B", "C"], topics: ["CRM"] };
describe("exact strategy changes", () => {
  it("resolves a batch revision against the existing profile through domain validation", () => {
    expect(resolveProfileChange({ profile: { productDescription: "Revised" }, keywords: ["sales"] }, profile)).toMatchObject({ productDescription: "Revised", topics: ["sales"], competitors: ["A", "B", "C"] });
    expect(() => resolveProfileChange({ competitors: ["A"] }, profile)).toThrow();
    expect(() => resolveProfileChange({ profile: { productUrl: "http://127.0.0.1" } }, profile)).toThrow();
  });
  it("honors force-manual material including an explicitly empty replacement", () => {
    const current = { ...profile, productMaterialStatus: "ok" as const, productMaterialText: "Previously fetched" };
    expect(resolveProfileChange({ profile: { forceManualMaterial: true } }, current)).toMatchObject({ materialStatus: "manual", materialText: "" });
    expect(resolveProfileChange({ profile: { forceManualMaterial: true, productMaterialManual: "  Owner text  " } }, current)).toMatchObject({ materialStatus: "manual", materialText: "Owner text" });
    expect(resolveProfileChange({ keywords: ["sales"] }, current)).toMatchObject({ materialStatus: "ok", materialText: "Previously fetched" });
  });
  it.each([{}, { profile: { version: 42 } }, { expertiseNotes: [{ text: "Expert", evidenceIds: [], confirmed: true }] }, { keywords: ["ok"], actorId: "model" }, { keywords: Array(13).fill("x") }])("rejects unknown fields and model-granted authority: %j", value => {
    expect(strategyChangeSchema.safeParse(value).success).toBe(false);
  });
  it("uses the existing source builder and requires explicit activation", () => {
    expect(resolveSourceChange({ type: "hn", config: { query: "CRM" }, enabled: false })).toMatchObject({ type: "hn", health: "paused", config: { queries: ["CRM"] } });
    expect(() => resolveSourceChange({ type: "hn", config: { query: "CRM", maxPages: 999 }, enabled: true })).toThrow();
    expect(() => resolveSourceChange({ type: "rss", config: { feedUrl: "http://localhost/feed" }, enabled: true })).toThrow();
  });
  it("accepts only an exact SDK approval response, never natural language or a model actor", () => {
    const decision = { workspaceId: crypto.randomUUID(), conversationId: crypto.randomUUID(), strategyVersion: 0, requestId: "click-1", payloadHash: "a".repeat(64), state: "approval-responded", approval: { id: crypto.randomUUID(), approved: true } };
    expect(proposalDecisionSchema.parse(decision)).toEqual(decision);
    for (const value of ["yes", { ...decision, state: "approval-requested" }, { ...decision, actorId: "model" }, { ...decision, approval: { ...decision.approval, approved: "yes" } }, { ...decision, approval: { ...decision.approval, isAutomatic: true } }]) expect(proposalDecisionSchema.safeParse(value).success).toBe(false);
  });
});
