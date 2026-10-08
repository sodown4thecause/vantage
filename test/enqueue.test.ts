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

import { enqueueEmbedJob } from "@/lib/cf/queue";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const JOB = { type: "backfill-documents", workspaceId: WORKSPACE_ID } as const;

beforeEach(() => {
  state.throwContext = false;
  state.env = {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
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
