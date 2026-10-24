import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ execute: mocks.execute }) }));

import { reserveCostAttemptToday } from "@/lib/costs/ledger";

const input = { workspaceId: "11111111-1111-4111-8111-111111111111", provider: "scavio", action: "reddit_hydrate", max: 5 };
const dialect = new PgDialect();

beforeEach(() => { mocks.execute.mockReset().mockResolvedValue([{ attempts: 5 }]); });

describe("workspace daily attempt reservations", () => {
  it("uses one guarded upsert scoped to workspace, UTC day, provider and action", async () => {
    expect(await reserveCostAttemptToday(input)).toBe(true);
    expect(mocks.execute).toHaveBeenCalledOnce();
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).toContain("on conflict (workspace_id, day, provider, action) do update");
    expect(query.sql).toContain("set attempts = workspace_provider_quota.attempts + 1");
    expect(query.sql).toMatch(/where workspace_provider_quota.attempts < \$\d+::integer/);
    expect(query.sql).toContain("count(*) + 1");
    expect(query.sql).toContain("at time zone 'UTC'");
    expect(query.params).toEqual([
      input.workspaceId, new Date().toISOString().slice(0, 10), input.provider, input.action,
      input.workspaceId, input.provider, input.action, new Date().toISOString().slice(0, 10), 5, 5,
    ]);
  });

  it("returns false when the atomic cap guard denies a reservation", async () => {
    mocks.execute.mockResolvedValue([]);
    expect(await reserveCostAttemptToday(input)).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Infinity])("does not reserve for invalid cap %s", async max => {
    expect(await reserveCostAttemptToday({ ...input, max })).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("propagates database failure so callers can fail closed", async () => {
    mocks.execute.mockRejectedValue(new Error("db down"));
    await expect(reserveCostAttemptToday(input)).rejects.toThrow("db down");
  });
});
