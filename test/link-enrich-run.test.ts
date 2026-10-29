import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentRecord } from "@/lib/db/schema";
import { decideFromCache, enrichLinkDocuments } from "@/lib/enrich/run";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), fetchPage: vi.fn(), fetchYoutube: vi.fn(), summarise: vi.fn(), paid: vi.fn(), available: vi.fn(), denied: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/enrich/scrape", () => ({ fetchLinkedPage: mocks.fetchPage, fetchYoutubeTranscript: mocks.fetchYoutube }));
vi.mock("@/lib/enrich/summarise", () => ({ summariseLinkedPage: mocks.summarise, summariserAvailable: mocks.available }));
vi.mock("@/lib/providers/paid-call", () => ({ runPaidCall: mocks.paid, isPaidCallDenied: mocks.denied }));

type CacheRow = NonNullable<Parameters<typeof decideFromCache>[0]>;
const fresh: CacheRow = { status: "ok", title: "Cached", summary: "Cached summary", fetchedAt: new Date(), attempts: 1, lastAttemptAt: new Date() };
const docs = Array.from({ length: 12 }, (_, i) => ({
  id: `doc-${i}`, title: "Read this", contentMd: "", urlCanonical: `https://example.com/${i}`,
})) as DocumentRecord[];

function mockDb(rows: Array<CacheRow | null> = [], used = 0) {
  const values = vi.fn((row: Record<string, unknown>) => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(row) }));
  const db = {
    select: vi.fn((fields?: unknown) => ({
      from: () => ({
        where: () => fields ? Promise.resolve([{ n: used }]) : { limit: async () => {
          const row = rows.shift();
          return row ? [row] : [];
        } },
      }),
    })),
    insert: vi.fn(() => ({ values })),
  };
  mocks.getDb.mockReturnValue(db);
  return values;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ENRICH_DAILY_MAX", "2");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  vi.stubEnv("SUPADATA_API_KEY", "test-key");
  mocks.fetchPage.mockResolvedValue({ outcome: "ok", value: { title: "Page", text: "Content" } });
  mocks.summarise.mockResolvedValue({ summary: "Summary", costUsd: 0.001 });
  mocks.available.mockReturnValue(true);
  mocks.denied.mockReturnValue(false);
  mocks.paid.mockImplementation(async (_meta, work) => (await work()).value);
});
afterEach(() => vi.unstubAllEnvs());

describe("enrichment attempt budget", () => {
  it.each(["failed", "skipped"])("limits concurrent %s fetches rather than counting successes", async (outcome) => {
    mockDb([], 1);
    mocks.fetchPage.mockResolvedValue({ outcome, reason: "Unavailable" });
    const result = await enrichLinkDocuments(docs, { workspaceId: "ws" });
    expect(result.size).toBe(0);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
  });

  it("does not charge cache hits against the remaining attempt slot", async () => {
    mockDb([fresh, null, null, fresh], 1);
    const result = await enrichLinkDocuments(docs.slice(0, 4), { workspaceId: "ws" });
    expect(result.size).toBe(3);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
  });

  it("still returns cache hits when the daily attempt budget is exhausted", async () => {
    mockDb([fresh, null], 2);
    const result = await enrichLinkDocuments(docs.slice(0, 2), { workspaceId: "ws" });
    expect(result.get("doc-0")?.summary).toBe("Cached summary");
    expect(mocks.fetchPage).not.toHaveBeenCalled();
  });
});

describe("enrichment retries", () => {
  it("persists a first summary failure with the existing 24-hour retry window", async () => {
    const values = mockDb();
    mocks.summarise.mockResolvedValue(null);
    await enrichLinkDocuments(docs.slice(0, 1), { workspaceId: "ws" });
    const row = values.mock.calls[0][0] as CacheRow;
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(decideFromCache(row)).toEqual({ action: "skip" });
    expect(decideFromCache(row, new Date(Date.now() + 25 * 60 * 60 * 1000))).toEqual({ action: "fetch", priorAttempts: 1 });
  });

  it.each(["missing", "rejected"])("persists a failed attempt for a %s summary", async (failure) => {
    const values = mockDb([{ ...fresh, status: "failed", fetchedAt: null, summary: null, lastAttemptAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }]);
    if (failure === "missing") mocks.summarise.mockResolvedValue(null);
    else mocks.summarise.mockRejectedValue(new Error("Gateway unavailable"));
    const result = await enrichLinkDocuments(docs.slice(0, 1), { workspaceId: "ws" });
    expect(result.size).toBe(0);
    const row = values.mock.calls[0]?.[0];
    expect(row).toMatchObject({ status: "failed", attempts: 2, summary: null, fetchedAt: null });
  });

  it.each(["FIRECRAWL_API_KEY", "SUPADATA_API_KEY"])("does not cache missing %s credentials", async (key) => {
    const values = mockDb();
    const candidate = { ...docs[0], urlCanonical: key === "SUPADATA_API_KEY" ? "https://youtu.be/abc" : docs[0].urlCanonical };
    vi.stubEnv(key, "");
    await enrichLinkDocuments([candidate], { workspaceId: "ws" });
    await enrichLinkDocuments([candidate], { workspaceId: "ws" });
    expect(values).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
    vi.stubEnv(key, "restored-key");
    mocks.fetchYoutube.mockResolvedValue({ outcome: "ok", value: { title: null, text: "Transcript" } });
    await enrichLinkDocuments([candidate], { workspaceId: "ws" });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ status: "ok" }));
  });
});

describe("summariser unavailable or denied", () => {
  it("skips the paid page fetch when no summariser is configured, and records no attempt", async () => {
    const values = mockDb();
    mocks.available.mockReturnValue(false);
    const result = await enrichLinkDocuments(docs.slice(0, 1), { workspaceId: "ws" });
    expect(result.size).toBe(0);
    expect(mocks.fetchPage).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it("does not count a budget-denied summary as an attempt", async () => {
    const values = mockDb([{ ...fresh, status: "failed", fetchedAt: null, summary: null, attempts: 1, lastAttemptAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }]);
    const denial = new Error("Daily budget reached");
    mocks.summarise.mockRejectedValue(denial);
    mocks.denied.mockImplementation((err) => err === denial);
    const result = await enrichLinkDocuments(docs.slice(0, 1), { workspaceId: "ws" });
    expect(result.size).toBe(0);
    expect(values).not.toHaveBeenCalled();
  });
});

describe("documents sharing one uncached link", () => {
  const shared = (id: string) => ({ ...docs[0], id, urlCanonical: "https://example.com/shared" }) as DocumentRecord;

  it("fetches and summarises once and applies the result to every matching document", async () => {
    const values = mockDb([], 0);
    const result = await enrichLinkDocuments([shared("a"), shared("b"), shared("c")], { workspaceId: "ws" });
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
    expect(mocks.summarise).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect([...result.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(result.get("b")?.summary).toBe("Summary");
  });

  it("spends one daily slot and one attempt on a shared failing link", async () => {
    const values = mockDb([], 1);
    mocks.fetchPage.mockResolvedValue({ outcome: "failed", reason: "Unavailable" });
    const result = await enrichLinkDocuments([shared("a"), shared("b"), { ...docs[1] }], { workspaceId: "ws" });
    expect(result.size).toBe(0);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).toMatchObject({ status: "failed", attempts: 1 });
  });
});
