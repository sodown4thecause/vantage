import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limits = vi.hoisted(() => ({ assert: vi.fn(async () => undefined) }));
vi.mock("@/lib/plans/limits", async (original) => ({ ...await original<typeof import("@/lib/plans/limits")>(), assertWithinCount: limits.assert }));

import {
  confirmProfileProposal,
  decideCompetitor,
  decideKeyword,
  decideSourceRemoval,
  ingestReviewedSources,
  queueTermSource,
} from "@/lib/agents/discovery";
import { monitoringProfile, source, sourceProposal } from "@/lib/db/schema";
import { PlanLimitError } from "@/lib/plans/types";
import { fakeDb } from "./helpers/fake-db";

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

afterEach(() => { vi.unstubAllGlobals(); });

beforeEach(() => {
  limits.assert.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("no raw fetch from the Worker"); }));
});

const proposal = {
  id: ID, workspaceId: WS, productUrl: "https://contextfor.dev/", productName: "Vantage", description: "Finds conversations.",
  category: "GTM tooling", audience: "Founders of AI developer tools", pricingTier: "paid", differentiators: ["Owner writes every reply"],
  evidenceUrl: "https://contextfor.dev/", status: "proposed",
};

describe("confirmProfileProposal", () => {
  it("saves the next monitoring profile version from the proposal without fetching the site", async () => {
    const { db, ops } = fakeDb([[proposal], [{ version: 2, topics: ["gtm"], competitors: ["syften.com"], docsUrls: [] }]], [[{ id: "new-profile-id" }]]);
    expect(await confirmProfileProposal(WS, ID, db)).toEqual({ ok: true, version: 3, profileId: "new-profile-id" });
    const insert = ops.find((op) => op.kind === "insert" && op.table === monitoringProfile)!;
    expect(insert.values).toMatchObject({
      workspaceId: WS, version: 3, productUrl: "https://contextfor.dev/", productDescription: "Finds conversations.",
      targetCustomer: "Founders of AI developer tools", topics: ["gtm"], competitors: ["syften.com"], productMaterialStatus: "manual",
    });
    expect(fetch).not.toHaveBeenCalled();
    const lookup = ops[0]!;
    expect(lookup.where!.params).toEqual(expect.arrayContaining([WS, ID]));
  });

  it("starts at version 1 for a new workspace and reports a proposal that is not the caller's as not found", async () => {
    const first = fakeDb([[proposal], []], [[{ id: "p1" }]]);
    expect(await confirmProfileProposal(WS, ID, first.db)).toEqual({ ok: true, version: 1, profileId: "p1" });
    const missing = fakeDb([[]]);
    expect(await confirmProfileProposal(WS, ID, missing.db)).toEqual({ ok: false });
    expect(missing.ops.filter((op) => op.kind !== "select")).toHaveLength(0);
  });
});

describe("owner decisions on competitors and keywords", () => {
  it("only moves a still-proposed row in the caller's workspace", async () => {
    const { db, ops } = fakeDb([], [[{ domain: "syften.com" }]]);
    expect(await decideCompetitor(WS, ID, "accepted", db)).toEqual({ ok: true, value: "syften.com" });
    const update = ops[0]!;
    expect(update.set).toMatchObject({ status: "accepted" });
    expect(update.where!.params).toEqual(expect.arrayContaining([WS, ID, "proposed"]));
  });

  it("reports ok:false when nothing matched, for competitors and for keywords", async () => {
    expect(await decideCompetitor(WS, ID, "rejected", fakeDb([], [[]]).db)).toEqual({ ok: false });
    expect(await decideKeyword(WS, ID, "rejected", fakeDb([], [[]]).db)).toEqual({ ok: false });
    expect(await decideKeyword(WS, ID, "accepted", fakeDb([], [[{ keyword: "syften alternative" }]]).db)).toEqual({ ok: true, value: "syften alternative" });
  });
});

describe("queueTermSource: accepted keywords and competitors feed source searches through the same gate", () => {
  const latest = [{ productDescription: "Finds the conversations where developers ask for tools like yours.", targetCustomer: "Founders of AI developer tools", productUrl: "https://contextfor.dev/", topics: ["developer tool marketing"], competitors: [] }];

  it("queues a Hacker News search for an accepted keyword that names something specific", async () => {
    const { db, ops } = fakeDb([latest, [], [{ keyword: "syften alternative" }]]);
    await queueTermSource(WS, "syften alternative", db);
    const insert = ops.find((op) => op.kind === "insert" && op.table === sourceProposal)!;
    expect(insert.values).toMatchObject({ workspaceId: WS, action: "add", sourceType: "hn", name: "Search (Hacker News): syften alternative", queries: ["syften alternative"], accepted: true, status: "reviewed" });
  });

  it("still rejects an accepted term that is generic, and records why", async () => {
    const { db, ops } = fakeDb([latest, [], [{ keyword: "tools" }]]);
    await queueTermSource(WS, "tools", db);
    const insert = ops.find((op) => op.kind === "insert" && op.table === sourceProposal)!;
    expect(insert.values).toMatchObject({ accepted: false, status: "rejected" });
    expect((insert.values as { reviewReasons: string[] }).reviewReasons.join(" ")).toMatch(/generic/i);
  });
});

describe("ingestReviewedSources", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: ID, workspaceId: WS, action: "add", sourceType: "hn", name: "HN: syften alternative", queries: ["syften alternative"],
    modelScore: "0.80", relevanceScore: "0.92", accepted: true, status: "reviewed", ...over,
  });

  it("selects only accepted, reviewed adds in the caller's workspace", async () => {
    const { db, ops } = fakeDb([[], []]);
    await ingestReviewedSources(WS, db, {});
    const where = ops[0]!.where!;
    expect(where.params).toEqual(expect.arrayContaining([WS, "add", true, "reviewed"]));
  });

  it("creates the source and marks the proposal ingested", async () => {
    const { db, ops } = fakeDb([[row()], []]);
    const result = await ingestReviewedSources(WS, db, {});
    expect(result).toEqual({ ingested: ["HN: syften alternative"], waiting: [] });
    const insert = ops.find((op) => op.kind === "insert" && op.table === source)!;
    expect(insert.values).toMatchObject({ workspaceId: WS, name: "HN: syften alternative", type: "hn", lane: "free", config: { queries: ["syften alternative"], maxPages: 1, enrich: false } });
    expect(ops.find((op) => op.kind === "update" && op.table === sourceProposal)!.set).toMatchObject({ status: "ingested" });
  });

  it("does not ingest a row whose scores are below the threshold, even if flagged accepted", async () => {
    const { db, ops } = fakeDb([[row({ relevanceScore: "0.36" }), row({ id: "x", name: "other", modelScore: "0.10" })], []]);
    const result = await ingestReviewedSources(WS, db, {});
    expect(result.ingested).toEqual([]);
    expect(ops.filter((op) => op.kind === "insert" && op.table === source)).toHaveLength(0);
  });

  it("leaves a keyed source waiting until its provider is configured", async () => {
    const reddit = row({ sourceType: "reddit", name: "Reddit: syften alternative" });
    const without = await ingestReviewedSources(WS, fakeDb([[reddit], []]).db, {});
    expect(without).toEqual({ ingested: [], waiting: ["Reddit: syften alternative"] });
    const withKey = fakeDb([[reddit], []]);
    expect((await ingestReviewedSources(WS, withKey.db, { SCAVIO_API_KEY: "k" })).ingested).toEqual(["Reddit: syften alternative"]);
    expect(withKey.ops.find((op) => op.kind === "insert" && op.table === source)!.values).toMatchObject({ type: "reddit", lane: "byok", config: { queries: ["syften alternative"], limit: 10 } });
  });

  it("stops at the plan's source limit and leaves the rest reviewed", async () => {
    limits.assert.mockRejectedValueOnce(new PlanLimitError("sources", 3, "Source limit reached."));
    const { db, ops } = fakeDb([[row()], []]);
    const result = await ingestReviewedSources(WS, db, {});
    expect(result).toEqual({ ingested: [], waiting: ["HN: syften alternative"] });
    expect(ops.filter((op) => op.kind === "insert" && op.table === source)).toHaveLength(0);
  });
});

describe("decideSourceRemoval", () => {
  it("pauses the source (reversible) when the owner accepts, scoped to the workspace", async () => {
    const { db, ops } = fakeDb([[{ id: ID, sourceId: "33333333-3333-4333-8333-333333333333", status: "removal_proposed", action: "remove" }]]);
    expect(await decideSourceRemoval(WS, ID, "accepted", db)).toEqual({ ok: true });
    const pause = ops.find((op) => op.kind === "update" && op.table === source)!;
    expect(pause.set).toMatchObject({ health: "paused" });
    expect(pause.where!.params).toEqual(expect.arrayContaining([WS, "33333333-3333-4333-8333-333333333333"]));
    expect(ops.some((op) => op.kind === "delete")).toBe(false);
  });

  it("leaves the source alone when the owner dismisses", async () => {
    const { db, ops } = fakeDb([[{ id: ID, sourceId: "33333333-3333-4333-8333-333333333333", status: "removal_proposed", action: "remove" }]]);
    expect(await decideSourceRemoval(WS, ID, "dismissed", db)).toEqual({ ok: true });
    expect(ops.some((op) => op.kind === "update" && op.table === source)).toBe(false);
  });
});
