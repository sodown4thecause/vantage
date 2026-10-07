import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "instance-1" })),
  binding: true,
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: () => ({
  from: (table: { id: unknown }) => {
    const rows = table === workspace ? [{ id: "ws-1" }] : [];
    return Object.assign(Promise.resolve(rows), { where: () => Object.assign(Promise.resolve(rows), { orderBy: () => ({ limit: async () => rows }), limit: async () => rows }) });
  },
}) }) }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: state.binding ? { RADAR_SCAN: { create: state.create } } : {} }) }));
vi.mock("@/lib/workflows/radar-scan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workflows/radar-scan")>();
  return actual;
});

import { workspace } from "@/lib/db/schema";
import { GET } from "@/app/api/cron/scan-workflow/route";

beforeEach(() => {
  state.create.mockClear();
  state.binding = true;
  vi.stubEnv("CRON_SECRET", "secret");
});

it("rejects an unauthorized trigger", async () => {
  const response = await GET(new Request("https://example.com/api/cron/scan-workflow"));
  expect(response.status).toBe(401);
  expect(state.create).not.toHaveBeenCalled();
});

it("enqueues a workflow per eligible workspace instead of scanning inline", async () => {
  const response = await GET(new Request("https://example.com/api/cron/scan-workflow", { headers: { authorization: "Bearer secret" } }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.enqueued).toEqual([{ workspaceId: "ws-1", instanceId: "instance-1" }]);
  expect(state.create).toHaveBeenCalledWith({ params: { workspaceId: "ws-1", enforceCadence: true } });
});

it("turns off cadence enforcement when a specific workspace is requested", async () => {
  await GET(new Request("https://example.com/api/cron/scan-workflow?workspaceId=ws-1", { headers: { authorization: "Bearer secret" } }));
  expect(state.create).toHaveBeenCalledWith({ params: { workspaceId: "ws-1", enforceCadence: false } });
});

it("answers 503 when the workflow binding is unavailable", async () => {
  state.binding = false;
  const response = await GET(new Request("https://example.com/api/cron/scan-workflow", { headers: { authorization: "Bearer secret" } }));
  expect(response.status).toBe(503);
});
