import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: async () =>
    state.authorized
      ? { ok: true, userId: "user-1" }
      : { ok: false, status: 403 as const, error: "forbidden" as const },
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
  })),
}));

import { getDb } from "@/lib/db/client";
import {
  unsubscribeDigest,
  updateDigestPreferences,
} from "@/app/actions/digest";

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  state.authorized = true;
  state.updates = [];
  vi.mocked(getDb).mockClear();
});

describe("updateDigestPreferences", () => {
  it("saves enabled digest settings with a valid address", async () => {
    const result = await updateDigestPreferences(
      { error: null },
      form({
        workspaceId: "workspace-1",
        digestEnabled: "on",
        digestEmail: "founder@example.com",
        digestHourUtc: "9",
      }),
    );

    expect(result).toEqual({ error: null, saved: true });
    expect(state.updates[0]).toMatchObject({
      digestEnabled: true,
      digestEmail: "founder@example.com",
      digestHourUtc: 9,
    });
  });

  it("requires an address when enabling and validates the format", async () => {
    expect(
      (
        await updateDigestPreferences(
          { error: null },
          form({ workspaceId: "workspace-1", digestEnabled: "on" }),
        )
      ).error,
    ).not.toBeNull();

    expect(
      (
        await updateDigestPreferences(
          { error: null },
          form({
            workspaceId: "workspace-1",
            digestEnabled: "on",
            digestEmail: "not-an-email",
          }),
        )
      ).error,
    ).not.toBeNull();

    expect(state.updates).toHaveLength(0);
  });

  it("allows disabling delivery without an address", async () => {
    const result = await updateDigestPreferences(
      { error: null },
      form({ workspaceId: "workspace-1" }),
    );
    expect(result).toEqual({ error: null, saved: true });
    expect(state.updates[0]).toMatchObject({
      digestEnabled: false,
      digestEmail: null,
    });
  });

  it("refuses unauthorized workspaces", async () => {
    state.authorized = false;
    const result = await updateDigestPreferences(
      { error: null },
      form({
        workspaceId: "workspace-1",
        digestEnabled: "on",
        digestEmail: "founder@example.com",
      }),
    );
    expect(result.error).not.toBeNull();
    expect(getDb).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });
});

describe("unsubscribeDigest", () => {
  it("disables delivery for the authorized workspace", async () => {
    const result = await unsubscribeDigest(
      { error: null },
      form({ workspaceId: "workspace-1" }),
    );
    expect(result).toEqual({ error: null, saved: true });
    expect(state.updates[0]).toMatchObject({ digestEnabled: false });
  });

  it("refuses unauthorized workspaces", async () => {
    state.authorized = false;
    const result = await unsubscribeDigest(
      { error: null },
      form({ workspaceId: "workspace-1" }),
    );
    expect(result.error).not.toBeNull();
    expect(getDb).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });
});
