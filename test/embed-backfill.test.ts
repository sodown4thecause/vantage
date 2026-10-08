import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getDb: vi.fn(),
  embedPending: vi.fn(async (..._args: unknown[]) => ({ embedded: 1 })),
  indexProfile: vi.fn(async (..._args: unknown[]) => ({ indexed: 1 })),
  indexMaterial: vi.fn(async (..._args: unknown[]) => 1),
  vectorizeAvailable: true,
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => state.getDb() }));
vi.mock("@/lib/embeddings/index-documents", () => ({
  embedPendingDocuments: (...args: unknown[]) => state.embedPending(...args),
}));
vi.mock("@/lib/embeddings/index-profile", () => ({
  indexProfile: (...args: unknown[]) => state.indexProfile(...args),
}));
vi.mock("@/lib/drafting/ground", () => ({
  indexMaterial: (...args: unknown[]) => state.indexMaterial(...args),
}));
vi.mock("@/lib/embeddings/store", () => ({
  isVectorizeAvailable: async () => state.vectorizeAvailable,
}));

import { runEmbedJob } from "@/lib/embeddings/backfill";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.stubEnv("VANTAGE_SEMANTIC_MODE", "shadow");
  state.getDb = vi.fn(() => { throw new Error("database should not be reached"); });
  state.embedPending = vi.fn(async (..._args: unknown[]) => ({ embedded: 1 }));
  state.indexProfile = vi.fn(async (..._args: unknown[]) => ({ indexed: 1 }));
  state.indexMaterial = vi.fn(async (..._args: unknown[]) => 1);
  state.vectorizeAvailable = true;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runEmbedJob", () => {
  it("indexes pending documents when the semantic mode is shadow", async () => {
    expect(await runEmbedJob({ type: "backfill-documents", workspaceId: WORKSPACE_ID })).toEqual({ embedded: 1 });
    expect(state.embedPending).toHaveBeenCalledTimes(1);
  });

  it("acknowledges the job without embedding when Vectorize is not bound", async () => {
    state.vectorizeAvailable = false;
    expect(await runEmbedJob({ type: "backfill-documents", workspaceId: WORKSPACE_ID })).toEqual({ skipped: "vectorize unavailable" });
    expect(state.embedPending).not.toHaveBeenCalled();
  });

  it("makes no database, AI, or Vectorize calls when the semantic mode is off", async () => {
    vi.stubEnv("VANTAGE_SEMANTIC_MODE", "off");
    const documents = await runEmbedJob({ type: "backfill-documents", workspaceId: WORKSPACE_ID });
    const profile = await runEmbedJob({ type: "index-profile", workspaceId: WORKSPACE_ID, profileId: PROFILE_ID });
    expect(documents).toEqual({ skipped: "semantic mode off" });
    expect(profile).toEqual({ skipped: "semantic mode off" });
    expect(state.getDb).not.toHaveBeenCalled();
    expect(state.embedPending).not.toHaveBeenCalled();
    expect(state.indexProfile).not.toHaveBeenCalled();
    expect(state.indexMaterial).not.toHaveBeenCalled();
  });
});
