import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ claimed: true, writes: [] as Array<{ values: Record<string, unknown>; where: unknown }> }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ update: () => ({
  set: (values: Record<string, unknown>) => ({ where: (where: unknown) => {
    state.writes.push({ values, where });
    return Object.assign(Promise.resolve(), { returning: async () => state.claimed ? [{ id: "ws-1" }] : [] });
  } }),
}) }) }));
import { claimScanLease, releaseScanLease, withWorkspaceScanLease } from "@/lib/cron/lease";

const toSql = (chunk: unknown) => new PgDialect().sqlToQuery(chunk as Parameters<PgDialect["sqlToQuery"]>[0]);

beforeEach(() => { state.claimed = true; state.writes = []; });
it("claimScanLease returns null while another lease is live", async () => {
  state.claimed = false;
  await expect(claimScanLease("ws-1", 5)).resolves.toBeNull();
});
it("claimScanLease takes only unset or expired leases and returns its token with the TTL", async () => {
  const token = await claimScanLease("ws-1", 5);
  expect(token).toEqual(expect.any(String));
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].values).toMatchObject({ scanLeaseToken: token });
  const claim = toSql(state.writes[0].where);
  expect(claim.sql).toContain('"scan_lease_until" is null');
  expect(claim.sql).toContain('"scan_lease_until" < now()');
  expect(toSql(state.writes[0].values.scanLeaseUntil).params).toContain(5);
});
it("releaseScanLease clears the lease in one UPDATE conditional on the token", async () => {
  await releaseScanLease("ws-1", "tok-a");
  expect(state.writes).toHaveLength(1);
  const release = toSql(state.writes[0].where);
  expect(release.sql).toContain('"scan_lease_token" = ');
  expect(release.params).toEqual(expect.arrayContaining(["ws-1", "tok-a"]));
  expect(state.writes[0].values).toMatchObject({ scanLeaseToken: null, scanLeaseUntil: null });
});
it("releaseScanLease with a stale token only matches that token", async () => {
  await releaseScanLease("ws-1", "stale-token");
  const release = toSql(state.writes[0].where);
  expect(release.params).toContain("stale-token");
  expect(release.params).not.toContain(null);
});
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
