import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  updates: [] as Array<{ values: Record<string, unknown>; where: unknown }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: async () =>
    state.authorized
      ? { ok: true, userId: "user-1" }
      : { ok: false, status: 403 as const, error: "forbidden" as const },
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (where: unknown) => {
          state.updates.push({ values, where });
        },
      }),
    }),
  }),
}));

import { setLeadStatus } from "@/app/actions/lead";

function leadForm(status: string): FormData {
  const formData = new FormData();
  formData.set("workspaceId", "workspace-1");
  formData.set("leadId", "lead-1");
  formData.set("status", status);
  return formData;
}

afterEach(() => {
  state.authorized = true;
  state.updates = [];
});

describe("setLeadStatus", () => {
  it("approves and rejects leads for the owning workspace", async () => {
    expect(await setLeadStatus({ error: null }, leadForm("approved"))).toEqual({
      error: null,
    });
    expect(state.updates[0]?.values).toMatchObject({ status: "approved" });

    await setLeadStatus({ error: null }, leadForm("rejected"));
    expect(state.updates[1]?.values).toMatchObject({ status: "rejected" });
  });

  it("rejects unknown statuses without touching the database", async () => {
    const result = await setLeadStatus({ error: null }, leadForm("deleted"));
    expect(result.error).toBe("Unknown review action.");
    expect(state.updates).toHaveLength(0);
  });

  it("refuses cross-workspace updates", async () => {
    state.authorized = false;
    const result = await setLeadStatus({ error: null }, leadForm("approved"));
    expect(result.error).toBe("Not authorized for this workspace.");
    expect(state.updates).toHaveLength(0);
  });
});
