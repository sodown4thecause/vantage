import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  record: vi.fn(),
  order: [] as string[],
  semantic: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({
    limit: async () => { state.order.push("select-documents"); return []; },
  }) }) }) }) }),
}));
vi.mock("@/lib/profile/repository", () => ({
  getLatestMonitoringProfile: async () => ({ version: 1, topics: ["CRM", "SEO"] }),
}));
vi.mock("@/lib/enrich/run", () => ({ enrichLinkDocuments: async () => new Map(), attachLinkedContext: async () => {} }));
vi.mock("@/lib/pipeline/shadow", () => ({ runSemanticStageDetailed: state.semantic }));
vi.mock("@/lib/trends/volume", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trends/volume")>()),
  recordWorkspaceTopicVolume: state.record,
}));

import { buildOpportunities } from "@/lib/opportunities/run";

beforeEach(() => {
  vi.resetAllMocks();
  state.order = [];
  state.record.mockImplementation(async () => { state.order.push("record"); return 0; });
  state.semantic.mockRejectedValue(new Error("Stop after normalization"));
});

it("records topic volume on every build path, before documents are read for scoring", async () => {
  await expect(buildOpportunities({ workspaceId: "ws" })).rejects.toThrow("Stop after normalization");
  expect(state.record).toHaveBeenCalledWith("ws", ["CRM", "SEO"]);
  expect(state.order).toEqual(["record", "select-documents"]);
});

it("a recording failure never blocks the build", async () => {
  state.record.mockRejectedValue(new Error("db down"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(buildOpportunities({ workspaceId: "ws" })).rejects.toThrow("Stop after normalization");
    expect(state.order).toEqual(["select-documents"]);
  } finally {
    error.mockRestore();
  }
});
