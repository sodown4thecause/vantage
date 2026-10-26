import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ effect: undefined as undefined | (() => (() => void)) }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: (effect: () => (() => void)) => { state.effect = effect; },
}));

import { FirstScanStatus } from "@/components/first-scan-status";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { location: { reload: vi.fn() } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["done", "partial"])("does not reload when opening an already %s scan", async (status) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ run: { status } })));
  FirstScanStatus({ workspaceId: "synthetic-workspace" });
  const cleanup = state.effect!();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(window.location.reload).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  cleanup();
});

it.each(["done", "partial"])("reloads once when an active scan becomes %s", async (status) => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ run: { status: "running" } }))
    .mockResolvedValue(Response.json({ run: { status } })));
  FirstScanStatus({ workspaceId: "synthetic-workspace" });
  const cleanup = state.effect!();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(window.location.reload).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  cleanup();
});

it("does not reload when an active scan fails, preserving unsent workspace messages", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ run: { status: "running" } }))
    .mockResolvedValue(Response.json({ run: { status: "failed" } })));
  FirstScanStatus({ workspaceId: "synthetic-workspace" });
  const cleanup = state.effect!();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(window.location.reload).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
  cleanup();
});
