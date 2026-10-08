import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  throwContext: false,
  env: {} as Record<string, unknown>,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (state.throwContext) throw new Error("no cloudflare context");
    return { env: state.env };
  },
}));

vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: async () => ({ ok: true }) }));
vi.mock("@/lib/profile/validate", () => ({
  validateMonitoringProfileInput: () => ({
    ok: true,
    value: { productUrl: "https://example.com", docsUrls: [], productDescription: "d", targetCustomer: "t", competitors: [], topics: ["x"] },
  }),
}));
vi.mock("@/lib/profile/repository", () => ({
  getLatestMonitoringProfile: vi.fn(),
  getMonitoringProfileVersion: vi.fn(),
  saveMonitoringProfile: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", productMaterialText: "material" })),
}));
vi.mock("@/lib/drafting/ground", () => ({ indexMaterial: vi.fn(async () => 1) }));

import { POST as postProfile } from "@/app/api/profile/route";
import { indexMaterial } from "@/lib/drafting/ground";
import { enqueueEmbedJob } from "@/lib/cf/queue";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const JOB = { type: "backfill-documents", workspaceId: WORKSPACE_ID } as const;

beforeEach(() => {
  state.throwContext = false;
  state.env = {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("enqueueEmbedJob", () => {
  it("returns false when the EMBED_QUEUE binding is absent", async () => {
    await expect(enqueueEmbedJob(JOB)).resolves.toBe(false);
  });

  it("returns false when the binding has no send method", async () => {
    state.env = { EMBED_QUEUE: {} };
    await expect(enqueueEmbedJob(JOB)).resolves.toBe(false);
  });

  it("returns false, without throwing, when there is no Cloudflare context", async () => {
    state.throwContext = true;
    await expect(enqueueEmbedJob(JOB)).resolves.toBe(false);
  });

  it("returns false, without throwing, when send rejects", async () => {
    state.env = { EMBED_QUEUE: { send: vi.fn().mockRejectedValue(new Error("queue unavailable")) } };
    await expect(enqueueEmbedJob(JOB)).resolves.toBe(false);
  });

  it("sends the message and returns true when the binding is present", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    state.env = { EMBED_QUEUE: { send } };
    await expect(enqueueEmbedJob(JOB)).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(JOB);
  });
});

describe("profile route indexing", () => {
  const request = () => new Request("https://example.com/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
  });

  it("still saves the profile (201) when the queue is absent, and indexes directly", async () => {
    const response = await postProfile(request());
    expect(response.status).toBe(201);
    await vi.waitFor(() => expect(indexMaterial).toHaveBeenCalledWith(WORKSPACE_ID, "22222222-2222-4222-8222-222222222222", "material"));
  });

  it("enqueues the profile instead of indexing directly when the queue accepts it", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    state.env = { EMBED_QUEUE: { send } };
    const response = await postProfile(request());
    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledWith({ type: "index-profile", workspaceId: WORKSPACE_ID, profileId: "22222222-2222-4222-8222-222222222222" });
    expect(indexMaterial).not.toHaveBeenCalled();
  });
});
