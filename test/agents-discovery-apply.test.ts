import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limits = vi.hoisted(() => ({ assert: vi.fn(async () => undefined) }));
const lease = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/cron/lease", async (original) => ({ ...await original<typeof import("@/lib/cron/lease")>(), withWorkspaceScanLease: lease.run }));
vi.mock("@/lib/plans/limits", async (original) => ({ ...await original<typeof import("@/lib/plans/limits")>(), assertWithinCount: limits.assert }));

import {
  confirmProfileProposal,
  decideCompetitor,
  decideKeyword,
  decideSourceRemoval,
  ingestReviewedSources,
  queueTermSource,
} from "@/lib/agents/discovery";
import { monitoringProfile, proposedProfile, source, sourceProposal } from "@/lib/db/schema";
import { ScanLeaseBusyError } from "@/lib/cron/lease-error";
import { PlanLimitError } from "@/lib/plans/types";
import { fakeDb } from "./helpers/fake-db";

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

afterEach(() => { vi.unstubAllGlobals(); });

beforeEach(() => {
  limits.assert.mockReset().mockResolvedValue(undefined);
  lease.run.mockReset().mockImplementation(async (_workspaceId: string, run: (signal: AbortSignal) => Promise<unknown>) => run(new AbortController().signal));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("no raw fetch from the Worker"); }));
});

const proposal = {
  id: ID, workspaceId: WS, productUrl: "https://contextfor.dev/", productName: "Vantage", description: "Finds conversations.",
  category: "GTM tooling", audience: "Founders of AI developer tools", pricingTier: "paid", differentiators: ["Owner writes every reply"],
  evidenceUrl: "https://contextfor.dev/", status: "proposed",
};

describe("confirmProfileProposal", () => {
  it("claims the proposal first, then saves the next monitoring profile version from it without fetching the site", async () => {
    const { db, ops } = fakeDb([[{ version: 2, topics: ["gtm"], competitors: ["syften.com"], docsUrls: [] }]], [[proposal], [{ id: "new-profile-id" }]]);
    expect(await confirmProfileProposal(WS, ID, db)).toEqual({ ok: true, version: 3, profileId: "new-profile-id" });
    const writes = ops.filter((op) => op.kind !== "select");
    expect(writes.map((op) => op.kind)).toEqual(["update", "insert"]);
    const [claim, insert] = writes as [typeof writes[number], typeof writes[number]];
    expect(claim.table).toBe(proposedProfile);
    expect(claim.set).toMatchObject({ status: "accepted" });
    expect(claim.where!.params).toEqual(expect.arrayContaining([WS, ID, "proposed"]));
    expect(insert.table).toBe(monitoringProfile);
    expect(insert.values).toMatchObject({
      workspaceId: WS, version: 3, productUrl: "https://contextfor.dev/", productDescription: "Finds conversations.",
      targetCustomer: "Founders of AI developer tools", topics: ["gtm"], competitors: ["syften.com"], productMaterialStatus: "manual",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts at version 1 for a new workspace and reports a proposal that is not the caller's as not found", async () => {
    const first = fakeDb([[]], [[proposal], [{ id: "p1" }]]);
    expect(await confirmProfileProposal(WS, ID, first.db)).toEqual({ ok: true, version: 1, profileId: "p1" });
    const missing = fakeDb([], [[]]);
    expect(await confirmProfileProposal(WS, ID, missing.db)).toEqual({ ok: false });
    expect(missing.ops.filter((op) => op.kind !== "update")).toHaveLength(0);
  });

  it("saves one profile version when two confirmations overlap: only the caller that claimed the proposal inserts", async () => {
    const winner = fakeDb([[]], [[proposal], [{ id: "p1" }]]);
    const loser = fakeDb([], [[]]);
    const results = await Promise.all([confirmProfileProposal(WS, ID, winner.db), confirmProfileProposal(WS, ID, loser.db)]);
    expect(results).toEqual([{ ok: true, version: 1, profileId: "p1" }, { ok: false }]);
    expect(loser.ops.some((op) => op.kind === "insert")).toBe(false);
  });

  it("puts the claim back to proposed when the profile save fails, so the owner can confirm again", async () => {
    const { db: inner, ops } = fakeDb([[]], [[proposal]]);
    const db = { ...(inner as object), insert: () => ({ values: () => ({ returning: () => Promise.reject(new Error("db down")) }) }) } as never;
    await expect(confirmProfileProposal(WS, ID, db)).rejects.toThrow("db down");
    const updates = ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(2);
    expect(updates[1]!.set).toMatchObject({ status: "proposed", decidedAt: null });
    expect(updates[1]!.where!.params).toEqual(expect.arrayContaining([WS, ID, "accepted"]));
  });
});

const savedProfile = (over: Record<string, unknown> = {}) => ({
  id: "profile-1", workspaceId: WS, version: 2, productUrl: "https://contextfor.dev/", docsUrls: [], productDescription: "Finds conversations.",
  targetCustomer: "Founders", competitors: [], topics: ["gtm"], productMaterialStatus: "manual", productMaterialText: "Material", retrievalNotes: "Notes", ...over,
});

describe("accepting a term before the owner has a confirmed profile", () => {
  it("refuses and leaves the proposal still proposed, so the owner can accept it after confirming", async () => {
    for (const decide of [decideCompetitor, decideKeyword]) {
      const { db, ops } = fakeDb([[]]);
      expect(await decide(WS, ID, "accepted", db)).toEqual({ ok: false, reason: "profile_required" });
      expect(ops.filter((op) => op.kind !== "select")).toHaveLength(0);
    }
  });

  it("still lets the owner reject a term without a profile", async () => {
    const { db, ops } = fakeDb([], [[{ domain: "syften.com" }]]);
    expect(await decideCompetitor(WS, ID, "rejected", db)).toEqual({ ok: true, value: "syften.com" });
    expect(ops.some((op) => op.kind === "select")).toBe(false);
  });
});

describe("accepted terms reach the profile that scoring reads", () => {
  it("saves a new profile version with the competitor added, copying everything else", async () => {
    const { db, ops } = fakeDb([[savedProfile()]], [[{ domain: "syften.com" }], [{ id: "profile-3" }]]);
    expect(await decideCompetitor(WS, ID, "accepted", db)).toEqual({ ok: true, value: "syften.com", profileId: "profile-3" });
    const insert = ops.find((op) => op.kind === "insert" && op.table === monitoringProfile)!;
    expect(insert.values).toMatchObject({ workspaceId: WS, version: 3, competitors: ["syften.com"], topics: ["gtm"], productUrl: "https://contextfor.dev/", productMaterialText: "Material" });
  });

  it("adds an accepted keyword to the topics, unless the plan's keyword limit is reached", async () => {
    const added = fakeDb([[savedProfile()]], [[{ keyword: "syften alternative" }], [{ id: "profile-3" }]]);
    expect(await decideKeyword(WS, ID, "accepted", added.db)).toMatchObject({ ok: true, profileId: "profile-3" });
    expect(added.ops.find((op) => op.kind === "insert" && op.table === monitoringProfile)!.values).toMatchObject({ topics: ["gtm", "syften alternative"] });

    limits.assert.mockRejectedValueOnce(new PlanLimitError("keywords", 1, "Keyword limit reached."));
    const capped = fakeDb([[savedProfile()]], [[{ keyword: "syften alternative" }]]);
    expect(await decideKeyword(WS, ID, "accepted", capped.db)).toEqual({ ok: true, value: "syften alternative" });
    expect(capped.ops.some((op) => op.kind === "insert" && op.table === monitoringProfile)).toBe(false);
  });

  it("puts the competitor or keyword back to proposed when saving it to the profile fails, so a retry can still accept it", async () => {
    const competitorRun = fakeDb([[savedProfile()]], [[{ domain: "syften.com" }]]);
    const failingInsert = { ...(competitorRun.db as object), insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: () => Promise.reject(new Error("db down")) }) }) }) } as never;
    await expect(decideCompetitor(WS, ID, "accepted", failingInsert)).rejects.toThrow("db down");
    const revertCompetitor = competitorRun.ops.filter((op) => op.kind === "update")[1]!;
    expect(revertCompetitor.set).toMatchObject({ status: "proposed", decidedAt: null });
    expect(revertCompetitor.where!.params).toEqual(expect.arrayContaining([WS, ID, "accepted"]));

    limits.assert.mockRejectedValueOnce(new Error("db down"));
    const keywordRun = fakeDb([[savedProfile()]], [[{ keyword: "syften alternative" }]]);
    await expect(decideKeyword(WS, ID, "accepted", keywordRun.db)).rejects.toThrow("db down");
    const revertKeyword = keywordRun.ops.filter((op) => op.kind === "update")[1]!;
    expect(revertKeyword.set).toMatchObject({ status: "proposed", decidedAt: null });
    expect(revertKeyword.where!.params).toEqual(expect.arrayContaining([WS, ID, "accepted"]));
  });

  it("writes nothing new when the term is already on the profile", async () => {
    const { db, ops } = fakeDb([[savedProfile({ competitors: ["Syften.com"] })]], [[{ domain: "syften.com" }]]);
    expect(await decideCompetitor(WS, ID, "accepted", db)).toEqual({ ok: true, value: "syften.com" });
    expect(ops.some((op) => op.kind === "insert")).toBe(false);
  });
});

describe("owner decisions on competitors and keywords", () => {
  it("only moves a still-proposed row in the caller's workspace", async () => {
    const { db, ops } = fakeDb([[savedProfile({ competitors: ["syften.com"] })]], [[{ domain: "syften.com" }]]);
    expect(await decideCompetitor(WS, ID, "accepted", db)).toEqual({ ok: true, value: "syften.com" });
    const update = ops.find((op) => op.kind === "update")!;
    expect(update.set).toMatchObject({ status: "accepted" });
    expect(update.where!.params).toEqual(expect.arrayContaining([WS, ID, "proposed"]));
  });

  it("reports ok:false when nothing matched, for competitors and for keywords", async () => {
    expect(await decideCompetitor(WS, ID, "rejected", fakeDb([], [[]]).db)).toEqual({ ok: false });
    expect(await decideKeyword(WS, ID, "rejected", fakeDb([], [[]]).db)).toEqual({ ok: false });
    expect(await decideKeyword(WS, ID, "accepted", fakeDb([[savedProfile({ topics: ["syften alternative"] })]], [[{ keyword: "syften alternative" }]]).db)).toEqual({ ok: true, value: "syften alternative" });
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

  it("ingests a source the AI review approved even when the proposing model's own score was low", async () => {
    const { db, ops } = fakeDb([[row({ modelScore: "0.20", relevanceScore: "0.81" })], []]);
    expect((await ingestReviewedSources(WS, db, {})).ingested).toEqual(["HN: syften alternative"]);
    expect(ops.some((op) => op.kind === "insert" && op.table === source)).toBe(true);
  });

  it("does not ingest a row whose review score is below the threshold, even if flagged accepted", async () => {
    const { db, ops } = fakeDb([[row({ relevanceScore: "0.36" }), row({ id: "x", name: "other", relevanceScore: "0.10" })], []]);
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

  it("starts a Reddit source on any provider the Reddit collector can use, not only TinyFish or Scavio", async () => {
    const reddit = row({ sourceType: "reddit", name: "Reddit: syften alternative" });
    for (const env of [{ FIRECRAWL_API_KEY: "k" }, { REDDIT_LINKUP_LANE: "true", LINKUP_API_KEY: "k" }, { TINYFISH_API_KEY: "k" }, { SCAVIO_API_KEY: "k" }]) {
      expect((await ingestReviewedSources(WS, fakeDb([[reddit], []]).db, env)).ingested).toEqual(["Reddit: syften alternative"]);
    }
    // The Linkup lane needs both its switch and its key.
    expect((await ingestReviewedSources(WS, fakeDb([[reddit], []]).db, { LINKUP_API_KEY: "k" })).waiting).toEqual(["Reddit: syften alternative"]);
    expect((await ingestReviewedSources(WS, fakeDb([[reddit], []]).db, { REDDIT_LINKUP_LANE: "true" })).waiting).toEqual(["Reddit: syften alternative"]);
  });

  it("adds sources inside the workspace scan lease, so it cannot interleave with a scan or another ingest", async () => {
    const { db } = fakeDb([[row()], []]);
    await ingestReviewedSources(WS, db, {});
    expect(lease.run).toHaveBeenCalledWith(WS, expect.any(Function));
  });

  it("takes no lease when there is nothing to ingest", async () => {
    await ingestReviewedSources(WS, fakeDb([[], []]).db, {});
    expect(lease.run).not.toHaveBeenCalled();
  });

  it("leaves the proposals reviewed and reports them waiting while a scan holds the lease", async () => {
    lease.run.mockRejectedValue(new ScanLeaseBusyError());
    const { db, ops } = fakeDb([[row()], []]);
    expect(await ingestReviewedSources(WS, db, {})).toEqual({ ingested: [], waiting: ["HN: syften alternative"] });
    expect(ops.filter((op) => op.kind === "insert" || op.kind === "update")).toHaveLength(0);
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
