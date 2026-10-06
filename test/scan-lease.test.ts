import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ claimed: true, writes: [] as Array<{ values: Record<string, unknown>; where: unknown }> }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ update: () => ({
  set: (values: Record<string, unknown>) => ({ where: (where: unknown) => {
    state.writes.push({ values, where });
    return Object.assign(Promise.resolve(), { returning: async () => state.claimed ? [{ id: "ws-1" }] : [] });
  } }),
}) }) }));
import { withWorkspaceScanLease } from "@/lib/cron/lease";

beforeEach(() => { state.claimed = true; state.writes = []; });
it("does not scan when another invocation owns the lease", async () => {
  state.claimed = false;
  const run = vi.fn();
  await expect(withWorkspaceScanLease("ws-1", run)).rejects.toThrow(/already running/);
  expect(run).not.toHaveBeenCalled();
});
it("releases only its own token even when the scan fails", async () => {
  await expect(withWorkspaceScanLease("ws-1", async () => { throw new Error("scan failed"); })).rejects.toThrow("scan failed");
  expect(state.writes).toHaveLength(2);
  const release = new PgDialect().sqlToQuery(state.writes[1].where as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(release.sql).toContain('"scan_lease_token"');
  expect(release.params).toContain(state.writes[0].values.scanLeaseToken);
  expect(state.writes[1].values).toMatchObject({ scanLeaseToken: null, scanLeaseUntil: null });
});
