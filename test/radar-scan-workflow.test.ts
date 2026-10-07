import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scanImpl: (async () => ({ collectorResults: [], opportunityResults: [] })) as () => Promise<unknown>,
  rollupCalls: 0,
}));

vi.mock("@/lib/cron/scan", () => ({ scanWorkspace: vi.fn(async (...args: unknown[]) => state.scanImpl(...(args as []))) }));
vi.mock("@/lib/costs/rollup", () => ({ rollupRecent: vi.fn(async () => { state.rollupCalls += 1; }) }));

import { RadarScanWorkflow, summarizeScan } from "@/lib/workflows/radar-scan";
import { scanWorkspace } from "@/lib/cron/scan";
import type { WorkflowStep } from "cloudflare:workers";

type StepRecord = { name: string; config: unknown };

/** Minimal WorkflowStep double: records calls and runs the callback like the runtime does. */
function mockStep() {
  const records: StepRecord[] = [];
  const step = {
    do: async (name: string, configOrCallback: unknown, maybeCallback?: unknown) => {
      const hasConfig = typeof maybeCallback === "function";
      const config = hasConfig ? configOrCallback : undefined;
      const callback = (hasConfig ? maybeCallback : configOrCallback) as () => Promise<unknown>;
      records.push({ name, config });
      return callback();
    },
    sleep: async () => {},
    sleepUntil: async () => {},
    waitForEvent: async () => ({ payload: undefined, timestamp: new Date() }),
  } as unknown as WorkflowStep;
  return { step, records };
}

/** The workflow's env is unused by `run`; the binding only matters for enqueue. */
const env = {} as never;

const event = (params: { workspaceId: string; enforceCadence?: boolean }) =>
  ({ payload: params, timestamp: new Date(), instanceId: "inst-1", workflowName: "radar-scan" });

beforeEach(() => {
  state.scanImpl = async () => ({ collectorResults: [], opportunityResults: [] });
  state.rollupCalls = 0;
  vi.mocked(scanWorkspace).mockClear();
});

it("runs scan-workspace then rollup-costs in order and forwards cadence", async () => {
  const { step, records } = mockStep();
  state.scanImpl = async () => ({
    collectorResults: [{ workspaceId: "ws-1", inserted: 2 }],
    opportunityResults: [{ workspaceId: "ws-1", scanned: 1, clusters: 1, upserted: 1 }],
  });

  const summary = await new RadarScanWorkflow({}, env).run(event({ workspaceId: "ws-1", enforceCadence: true }), step);

  expect(records.map((r) => r.name)).toEqual(["scan-workspace", "rollup-costs"]);
  expect(scanWorkspace).toHaveBeenCalledWith("ws-1", undefined, { enforceCadence: true });
  expect(summary).toMatchObject({ workspaceId: "ws-1", status: "ran" });
});

it("passes retry/timeout config to the scan step", async () => {
  const { step, records } = mockStep();
  await new RadarScanWorkflow({}, env).run(event({ workspaceId: "ws-1" }), step);
  expect(records[0].config).toEqual({
    retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
    timeout: "3 minutes",
  });
});

it("propagates a scan failure so the runtime can retry per config", async () => {
  const { step } = mockStep();
  state.scanImpl = async () => {
    throw new Error("database unavailable");
  };
  await expect(new RadarScanWorkflow({}, env).run(event({ workspaceId: "ws-1" }), step)).rejects.toThrow(/database unavailable/);
});

it("returns the monitoring-profile skip as a status, not a thrown error", async () => {
  const { step, records } = mockStep();
  state.scanImpl = async () => ({
    collectorResults: [],
    opportunityResults: [{ workspaceId: "ws-1", skipped: true, reason: "monitoring profile required" }],
  });

  const summary = await new RadarScanWorkflow({}, env).run(event({ workspaceId: "ws-1" }), step);

  expect(summary.status).toBe("skipped");
  expect(summary.reason).toBe("monitoring profile required");
  // Skipped runs do not need a cost rollup.
  expect(records.map((r) => r.name)).toEqual(["scan-workspace"]);
  expect(state.rollupCalls).toBe(0);
});

it("returns a small, JSON-serializable summary that drops document payloads", async () => {
  const { step } = mockStep();
  const hugeDoc = { body: "x".repeat(200_000) };
  state.scanImpl = async () => ({
    collectorResults: [{ workspaceId: "ws-1", documents: [hugeDoc] }, { workspaceId: "ws-1", skipped: true }, { workspaceId: "ws-1", error: "collector failed" }],
    opportunityResults: [{ workspaceId: "ws-1", clusters: [hugeDoc] }],
  });

  const summary = await new RadarScanWorkflow({}, env).run(event({ workspaceId: "ws-1" }), step);

  expect(summary).toEqual({
    workspaceId: "ws-1",
    status: "failed",
    collectors: { ran: 1, skipped: 1, errors: 1 },
    opportunities: { built: 1, skipped: 0, errors: 0 },
  });
  // The serialized summary must be far under the Workers 1 MiB step-result cap.
  expect(JSON.stringify(summary).length).toBeLessThan(2_000);
});

it("summarizeScan labels a run with no failures as ran", () => {
  expect(
    summarizeScan("ws-9", { collectorResults: [{ inserted: 1 }], opportunityResults: [{ scanned: 1 }] }),
  ).toMatchObject({ status: "ran", workspaceId: "ws-9" });
});
