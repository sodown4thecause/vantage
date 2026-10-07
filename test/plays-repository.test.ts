import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  inserted: [] as Array<Record<string, unknown>>,
  updateRow: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  detail: null as unknown,
}));

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return c;
}

const baseRow = {
  id: "play-1",
  workspaceId: "ws-1",
  opportunityId: "opp-1",
  destinationId: null,
  kind: "reply_brief",
  title: "t",
  rationale: "r",
  evidence: {},
  status: "suggested",
  effortEstimate: "s",
  createdAt: new Date("2026-10-07T00:00:00Z"),
  doneAt: null,
};

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => chain(() => state.selects.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.inserted.push(v);
        return {
          returning: async () => [
            { ...baseRow, id: `play-${state.inserted.length}`, ...v, createdAt: baseRow.createdAt, doneAt: null },
          ],
        };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.updates.push(v);
        return {
          where: () => ({
            returning: async () => (state.updateRow ? [{ ...state.updateRow, ...v }] : []),
          }),
        };
      },
    }),
  }),
}));

vi.mock("@/lib/opportunities/run", () => ({
  getOpportunityDetail: async () => state.detail,
}));

import {
  createPlay,
  listForOpportunity,
  PlayNotFoundError,
  setStatus,
  suggestForOpportunity,
} from "@/lib/plays/repository";

const evidence = (contentMd: string) => ({
  documentId: "doc-1",
  title: "",
  urlCanonical: "https://example.com/1",
  platform: "hn",
  contentMd,
  postedAt: null,
  provider: null,
});

beforeEach(() => {
  state.selects = [];
  state.inserted = [];
  state.updates = [];
  state.updateRow = null;
  state.detail = null;
});

describe("plays repository", () => {
  it("createPlay rejects an opportunity outside the workspace", async () => {
    state.selects = [[]];
    await expect(
      createPlay({ workspaceId: "ws-1", opportunityId: "opp-x", kind: "reply_brief", title: "t" }),
    ).rejects.toBeInstanceOf(PlayNotFoundError);
    expect(state.inserted).toHaveLength(0);
  });

  it("createPlay inserts a suggested play scoped to the workspace", async () => {
    state.selects = [[{ id: "opp-1" }]];
    const view = await createPlay({
      workspaceId: "ws-1",
      opportunityId: "opp-1",
      kind: "comparison_page",
      title: "Compare",
      effortEstimate: "m",
    });
    expect(state.inserted[0]).toMatchObject({
      workspaceId: "ws-1",
      opportunityId: "opp-1",
      kind: "comparison_page",
      destinationId: null,
    });
    expect(view.createdAt).toBe("2026-10-07T00:00:00.000Z");
  });

  it("listForOpportunity maps rows to views", async () => {
    state.selects = [[baseRow]];
    const plays = await listForOpportunity({ workspaceId: "ws-1", opportunityId: "opp-1" });
    expect(plays).toEqual([
      expect.objectContaining({ id: "play-1", status: "suggested", doneAt: null }),
    ]);
  });

  it("setStatus stamps doneAt only for done", async () => {
    state.updateRow = baseRow;
    const now = new Date("2026-10-08T00:00:00Z");
    await setStatus({ workspaceId: "ws-1", playId: "play-1", status: "done", now });
    await setStatus({ workspaceId: "ws-1", playId: "play-1", status: "dismissed", now });
    expect(state.updates[0]).toMatchObject({ status: "done", doneAt: now });
    expect(state.updates[1]).toMatchObject({ status: "dismissed", doneAt: null });
  });

  it("setStatus throws not found when no row matches the workspace", async () => {
    await expect(
      setStatus({ workspaceId: "ws-1", playId: "play-x", status: "accepted" }),
    ).rejects.toBeInstanceOf(PlayNotFoundError);
  });
});

describe("suggestForOpportunity", () => {
  it("throws when the opportunity is not found", async () => {
    await expect(
      suggestForOpportunity({ workspaceId: "ws-1", opportunityId: "opp-1" }),
    ).rejects.toBeInstanceOf(PlayNotFoundError);
  });

  it("classifies the evidence and stores plays with the venue gate in evidence", async () => {
    state.detail = { evidence: [evidence("We are migrating away from Datadog")] };
    // profile lookup, existing plays, then one opportunity check per created play
    state.selects = [[{ productMaterialText: "docs here" }], [], [{ id: "opp-1" }], [{ id: "opp-1" }], [{ id: "opp-1" }]];
    const created = await suggestForOpportunity({ workspaceId: "ws-1", opportunityId: "opp-1" });
    expect(created.map((p) => p.kind)).toEqual(["migration_guide", "importer", "reply_brief"]);
    expect(state.inserted[0]?.evidence).toMatchObject({
      situation: "migration",
      venueMode: "link_if_asked",
      productHasDocs: true,
      documentIds: ["doc-1"],
    });
  });

  it("does not re-create kinds that already exist, including dismissed ones", async () => {
    state.detail = { evidence: [evidence("Any alternatives to Datadog?")] };
    state.selects = [
      [{ productMaterialText: "" }],
      [{ ...baseRow, kind: "reply_brief", status: "dismissed" }],
      [{ id: "opp-1" }],
      [{ id: "opp-1" }],
    ];
    const created = await suggestForOpportunity({ workspaceId: "ws-1", opportunityId: "opp-1" });
    expect(created.map((p) => p.kind)).toEqual(["comparison_page", "directory_submission"]);
  });

  it("creates nothing for an unclassified conversation", async () => {
    state.detail = { evidence: [evidence("nice weather today")] };
    state.selects = [[], []];
    expect(
      await suggestForOpportunity({ workspaceId: "ws-1", opportunityId: "opp-1" }),
    ).toEqual([]);
    expect(state.inserted).toHaveLength(0);
  });
});
