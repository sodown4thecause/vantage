import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  dueWorkspaces: [] as Array<{
    id: string;
    digestEmail: string | null;
    digestHourUtc: number;
    digestLastSentAt: Date | null;
  }>,
  leadsSent: [] as string[],
  markedSent: [] as string[],
  apiKey: "re_test_key" as string | undefined,
  sendShouldFail: false,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => state.dueWorkspaces,
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {},
      }),
    }),
  }),
}));

vi.mock("@/lib/env/server", () => ({
  optionalEnv: (name: string, env?: Record<string, string | undefined>) =>
    (env ?? process.env)[name],
  resendApiKey: () => state.apiKey,
  digestFromAddress: () => "digest@contextfor.dev",
  digestFromName: () => "Vantage",
}));

vi.mock("@/lib/digest/select", () => ({
  selectDigestOpportunities: async (workspaceId: string) => {
    state.leadsSent.push(workspaceId);
    return [
      {
        leadId: "lead-1",
        score: 90,
        intentRung: 3,
        reason: "reason",
        platform: "reddit",
        title: "A post",
        url: "https://reddit.com/x",
      },
    ];
  },
}));

vi.mock("@/lib/digest/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/digest/send")>();
  return {
    ...actual,
    sendDigestEmail: async (input: { workspaceId: string }) => {
      if (state.sendShouldFail) {
        return { ok: false as const, error: "nope" };
      }
      state.leadsSent.push(`sent:${input.workspaceId}`);
      return { ok: true as const };
    },
    markDigestSent: async (workspaceId: string) => {
      state.markedSent.push(workspaceId);
    },
  };
});

import { runDueDigests } from "@/lib/digest/dispatch";

afterEach(() => {
  state.dueWorkspaces = [];
  state.leadsSent = [];
  state.markedSent = [];
  state.apiKey = "re_test_key";
  state.sendShouldFail = false;
});

describe("runDueDigests", () => {
  const now = new Date("2026-10-09T14:00:00.000Z");

  it("sends to a due workspace and records the send", async () => {
    state.dueWorkspaces = [
      {
        id: "workspace-1",
        digestEmail: "founder@example.com",
        digestHourUtc: 13,
        digestLastSentAt: null,
      },
    ];

    const summary = await runDueDigests(now);

    expect(summary).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
    expect(state.leadsSent).toContain("sent:workspace-1");
    expect(state.markedSent).toEqual(["workspace-1"]);
  });

  it("skips workspaces whose preferred hour has not arrived", async () => {
    state.dueWorkspaces = [
      {
        id: "workspace-late",
        digestEmail: "founder@example.com",
        digestHourUtc: 22,
        digestLastSentAt: new Date("2026-10-08T20:00:00.000Z"),
      },
    ];

    const summary = await runDueDigests(now);

    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(state.leadsSent).toHaveLength(0);
  });

  it("skips workspaces without a delivery address", async () => {
    state.dueWorkspaces = [
      {
        id: "workspace-no-email",
        digestEmail: null,
        digestHourUtc: 13,
        digestLastSentAt: null,
      },
    ];

    const summary = await runDueDigests(now);

    expect(summary.skipped).toBe(1);
    expect(state.markedSent).toHaveLength(0);
  });

  it("counts send failures without marking the digest sent", async () => {
    state.dueWorkspaces = [
      {
        id: "workspace-fail",
        digestEmail: "founder@example.com",
        digestHourUtc: 13,
        digestLastSentAt: null,
      },
    ];
    state.sendShouldFail = true;

    const summary = await runDueDigests(now);

    expect(summary.failed).toBe(1);
    expect(state.markedSent).toHaveLength(0);
  });

  it("does nothing when no workspace is due", async () => {
    const summary = await runDueDigests(now);
    expect(summary).toEqual({ checked: 0, sent: 0, skipped: 0, failed: 0 });
  });
});
