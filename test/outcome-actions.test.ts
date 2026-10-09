import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  leadFound: false,
  inserted: [] as Array<Record<string, unknown>>,
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
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.leadFound ? [{ id: "lead-1" }] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          state.inserted.push(values);
          return [];
        },
      }),
    }),
  }),
}));

import { recordOutcomeFromForm } from "@/app/actions/outcome";
import {
  OUTCOME_TYPES,
  isOutcomeType,
  recordOutcome,
} from "@/lib/outcomes/record";

function outcomeForm(type: string): FormData {
  const formData = new FormData();
  formData.set("workspaceId", "workspace-1");
  formData.set("leadId", "lead-1");
  formData.set("outcomeType", type);
  return formData;
}

afterEach(() => {
  state.authorized = true;
  state.leadFound = false;
  state.inserted = [];
});

describe("isOutcomeType", () => {
  it("accepts only the three outcome categories", () => {
    expect(isOutcomeType("useful")).toBe(true);
    expect(isOutcomeType("acted_on")).toBe(true);
    expect(isOutcomeType("meh")).toBe(false);
    expect(OUTCOME_TYPES).toEqual(["useful", "not_useful", "acted_on"]);
  });
});

describe("recordOutcome", () => {
  it("records an outcome for a lead in the same workspace", async () => {
    state.leadFound = true;
    const result = await recordOutcome({
      workspaceId: "workspace-1",
      leadId: "lead-1",
      outcomeType: "useful",
    });
    expect(result).toEqual({ ok: true });
    expect(state.inserted[0]).toMatchObject({
      workspaceId: "workspace-1",
      leadId: "lead-1",
      outcomeType: "useful",
    });
  });

  it("refuses leads outside the workspace", async () => {
    const result = await recordOutcome({
      workspaceId: "workspace-1",
      leadId: "lead-from-other-workspace",
      outcomeType: "useful",
    });
    expect(result.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
  });
});

describe("recordOutcomeFromForm", () => {
  it("records through the authorized form action", async () => {
    state.leadFound = true;
    const result = await recordOutcomeFromForm(
      { error: null },
      outcomeForm("acted_on"),
    );
    expect(result).toEqual({ error: null, recorded: "acted_on" });
    expect(state.inserted).toHaveLength(1);
  });

  it("refuses unauthorized workspaces and unknown outcomes", async () => {
    state.leadFound = true;
    state.authorized = false;
    expect(
      (await recordOutcomeFromForm({ error: null }, outcomeForm("useful")))
        .error,
    ).toBe("Not authorized for this workspace.");

    state.authorized = true;
    expect(
      (await recordOutcomeFromForm({ error: null }, outcomeForm("meh"))).error,
    ).toBe("Unknown outcome.");
    expect(state.inserted).toHaveLength(0);
  });
});
