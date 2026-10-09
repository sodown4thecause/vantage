import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  count: 0,
}));

function makeQuery(result: () => unknown[]) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  query.select = () => chain();
  query.from = () => chain();
  query.innerJoin = () => chain();
  query.where = () => chain();
  query.orderBy = () => chain();
  query.limit = async () => result();
  // Awaiting the chain (without .limit) resolves to the same rows.
  query.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result()).then(onFulfilled, onRejected);
  return query;
}

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: (fields: unknown) => {
      void fields;
      return makeQuery(() => state.rows);
    },
  }),
}));

import {
  REVIEW_QUEUE_PAGE_SIZE,
  countReviewQueue,
  decodeReviewQueueCursor,
  encodeReviewQueueCursor,
  listReviewQueue,
  listReviewQueuePage,
} from "@/lib/pipeline/run";

function leadRow(score: number, createdAt: string, id: string) {
  return {
    lead: {
      id,
      workspaceId: "workspace-1",
      documentId: `doc-${id}`,
      intentRung: 1,
      confidence: 0.5,
      score,
      factors: {},
      windowMinutes: null,
      reason: "reason",
      status: "new",
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    },
    document: {
      id: `doc-${id}`,
      workspaceId: "workspace-1",
      sourceId: null,
      urlCanonical: `https://example.com/${id}`,
      platform: "reddit",
      authorRef: null,
      title: `title-${id}`,
      postedAt: new Date(createdAt),
      contentMd: "body",
      contentHash: `hash-${id}`,
      rawSnapshotRef: null,
      metadata: { provider: "scavio", mocked: false },
      collectedAt: new Date(createdAt),
      createdAt: new Date(createdAt),
    },
  };
}

describe("review queue cursor", () => {
  it("round-trips a cursor", () => {
    const cursor = { score: 12.5, createdAt: new Date("2026-10-01T10:00:00.000Z"), id: "lead-9" };
    const decoded = decodeReviewQueueCursor(
      encodeReviewQueueCursor(cursor),
    );
    expect(decoded?.id).toBe("lead-9");
    expect(decoded?.score).toBe(12.5);
    expect(decoded?.createdAt.toISOString()).toBe(
      "2026-10-01T10:00:00.000Z",
    );
  });

  it("returns null for missing or malformed cursors", () => {
    expect(decodeReviewQueueCursor(undefined)).toBeNull();
    expect(decodeReviewQueueCursor("")).toBeNull();
    expect(decodeReviewQueueCursor("not-base64-json")).toBeNull();
  });
});

describe("listReviewQueuePage", () => {
  it("returns the page and a cursor when more rows exist", async () => {
    const rows = [
      leadRow(9, "2026-10-03T00:00:00.000Z", "a"),
      leadRow(8, "2026-10-02T00:00:00.000Z", "b"),
    ];
    state.rows = rows;

    const page = await listReviewQueuePage({ workspaceId: "workspace-1", limit: 1 });

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.lead.id).toBe("a");
    expect(page.nextCursor).toBeTruthy();
    expect(decodeReviewQueueCursor(page.nextCursor ?? "")?.id).toBe("a");
  });

  it("has no cursor on the final page", async () => {
    state.rows = [leadRow(9, "2026-10-03T00:00:00.000Z", "a")];

    const page = await listReviewQueuePage({ workspaceId: "workspace-1", limit: 1 });

    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("caps and floors the requested page size", async () => {
    state.rows = [];
    await listReviewQueuePage({ workspaceId: "workspace-1", limit: 0 });
    await listReviewQueuePage({ workspaceId: "workspace-1", limit: 10_000 });
    expect(REVIEW_QUEUE_PAGE_SIZE).toBe(50);
  });

  it("keeps listReviewQueue working as a page wrapper", async () => {
    state.rows = [leadRow(5, "2026-10-01T00:00:00.000Z", "a")];
    const rows = await listReviewQueue("workspace-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lead.id).toBe("a");
  });
});

describe("countReviewQueue", () => {
  it("returns the queue size", async () => {
    state.rows = [{ count: 7 }];
    await expect(countReviewQueue("workspace-1")).resolves.toBe(7);
  });

  it("defaults to zero when the count row is missing", async () => {
    state.rows = [];
    await expect(countReviewQueue("workspace-1")).resolves.toBe(0);
  });
});
