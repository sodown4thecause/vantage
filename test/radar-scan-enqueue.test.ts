import { expect, it, vi } from "vitest";

import { enqueueRadarScan, isRadarScanEnv } from "@/lib/workflows/radar-scan";

const envWith = (create: ReturnType<typeof vi.fn>) => ({ RADAR_SCAN: { create } as never });

it("creates a workflow instance with the right params and returns its id", async () => {
  const create = vi.fn(async () => ({ id: "instance-42" }));
  const id = await enqueueRadarScan(envWith(create), { workspaceId: "ws-1", enforceCadence: true });

  expect(create).toHaveBeenCalledWith({ params: { workspaceId: "ws-1", enforceCadence: true } });
  expect(id).toBe("instance-42");
});

it("throws a clear error when the binding is missing", async () => {
  await expect(enqueueRadarScan({} as never, { workspaceId: "ws-1" })).rejects.toThrow(/RADAR_SCAN workflow binding is missing/);
});

it("throws when the RADAR_SCAN binding is present but not a workflow", async () => {
  await expect(enqueueRadarScan({ RADAR_SCAN: {} } as never, { workspaceId: "ws-1" })).rejects.toThrow(/missing/);
});

it("isRadarScanEnv only accepts a binding that exposes create", () => {
  expect(isRadarScanEnv({ RADAR_SCAN: { create: () => {} } })).toBe(true);
  expect(isRadarScanEnv({ RADAR_SCAN: {} })).toBe(false);
  expect(isRadarScanEnv({})).toBe(false);
  expect(isRadarScanEnv(null)).toBe(false);
});
