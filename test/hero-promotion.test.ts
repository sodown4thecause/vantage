import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), select: vi.fn(), from: vi.fn(), join: vi.fn(), where: vi.fn(), limit: vi.fn(), insert: vi.fn(), values: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: mocks.session } }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.access }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: mocks.select, insert: mocks.insert }) }));

import { POST } from "@/app/api/admin/hero-examples/route";
import { heroExample } from "@/lib/db/schema";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const opportunityId = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";
const source = {
  platform: "reddit", title: "Synthetic source title", sourceUrl: "https://example.com/r/synthetic/comments/test",
  content: "A synthetic document. How do I inspect retries? More synthetic text.",
  postedAt: new Date("2026-10-20T00:00:00Z"), metadata: { internal: "not public" },
};
function request(overrides: Record<string, unknown> = {}, origin = "https://vantage.test") {
  return new Request("https://vantage.test/api/admin/hero-examples", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, opportunityId, documentId, excerpt: "How do I inspect retries?", approvePublicDisplay: true, ...overrides }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VANTAGE_ADMIN_USER_IDS", "liam-test");
  mocks.session.mockResolvedValue({ data: { user: { id: "liam-test" } } });
  mocks.access.mockResolvedValue({ ok: true, userId: "liam-test" });
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ innerJoin: mocks.join });
  mocks.join.mockReturnValue({ innerJoin: mocks.join, where: mocks.where });
  mocks.where.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue([source]);
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("explicit admin hero promotion", () => {
  it.each([null, "other-user"])("refuses non-admin %s before touching workspace data", async (id) => {
    mocks.session.mockResolvedValue({ data: { user: id ? { id } : null } });
    expect((await POST(request())).status).toBe(404);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("requires an explicit public approval act, rejecting forged approver fields", async () => {
    for (const overrides of [{ approvePublicDisplay: false }, { approvePublicDisplay: undefined }, { approvedBy: "forged" }, { approvedAt: "2026-10-20" }]) {
      expect((await POST(request(overrides))).status).toBe(400);
    }
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes and unauthorised workspaces before source queries", async () => {
    expect((await POST(request({}, "https://other.test"))).status).toBe(403);
    mocks.access.mockResolvedValue({ ok: false, status: 403 });
    expect((await POST(request())).status).toBe(403);
    mocks.access.mockResolvedValue({ ok: true, userId: "different-actor" });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("copies only permitted source fields and derives actor/time server-side", async () => {
    const response = await POST(request());
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.access).toHaveBeenCalledWith(workspaceId);
    expect(mocks.insert).toHaveBeenCalledWith(heroExample);
    expect(mocks.values).toHaveBeenCalledWith({
      platform: "reddit", community: "r/synthetic", title: source.title, sourceUrl: source.sourceUrl,
      excerpt: "How do I inspect retries?", postedAt: source.postedAt,
      approvedBy: "liam-test", approvedAt: expect.any(Date),
    });
    const dialect = new PgDialect();
    const predicate = dialect.sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(predicate.params).toEqual([workspaceId, opportunityId, documentId]);
    expect(predicate.sql).toContain('"opportunity_evidence"."workspace_id"');
    for (const call of mocks.join.mock.calls) {
      const join = dialect.sqlToQuery(call[1]);
      expect(join.params).toEqual([workspaceId]);
      expect(join.sql).toContain('"workspace_id"');
    }
    expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.select.mock.invocationCallOrder[0]);
  });

  it.each(["invented quote", Array.from({ length: 26 }, () => "word").join(" "), " How do I inspect retries? "])("rejects non-verbatim or over-25-word excerpt: %s", async (excerpt) => {
    mocks.limit.mockResolvedValue([{ ...source, content: `${source.content} ${Array.from({ length: 26 }, () => "word").join(" ")}` }]);
    expect((await POST(request({ excerpt }))).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("accepts exactly 25 verbatim words", async () => {
    const excerpt = Array.from({ length: 25 }, () => "word").join(" ");
    mocks.limit.mockResolvedValue([{ ...source, content: excerpt }]);
    expect((await POST(request({ excerpt }))).status).toBe(200);
  });

  it.each([
    { rows: [] },
    { rows: [{ ...source, postedAt: null }] },
    { rows: [{ ...source, sourceUrl: "javascript:alert(1)" }] },
    { rows: [{ ...source, metadata: { mocked: true } }] },
  ])("rejects missing, undated, unsafe or mocked evidence", async ({ rows }) => {
    mocks.limit.mockResolvedValue(rows);
    expect((await POST(request())).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
