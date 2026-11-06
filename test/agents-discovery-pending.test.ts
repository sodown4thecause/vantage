import { describe, expect, it } from "vitest";

import { listPendingProposals } from "@/lib/agents/discovery";
import { fakeDb } from "./helpers/fake-db";

const WS = "11111111-1111-4111-8111-111111111111";

describe("listPendingProposals", () => {
  it("reads the latest proposed profile, proposed competitors and keywords, and reviewed sources, each scoped to the workspace", async () => {
    const { db, ops } = fakeDb([[{ id: "p1" }], [{ id: "c1" }], [{ id: "k1" }], [{ id: "s1" }]]);
    expect(await listPendingProposals(WS, db)).toEqual({ profile: { id: "p1" }, competitors: [{ id: "c1" }], keywords: [{ id: "k1" }], sources: [{ id: "s1" }] });
    expect(ops).toHaveLength(4);
    for (const op of ops) expect(op.where!.params).toContain(WS);
  });

  it("returns a null profile when none is waiting", async () => {
    const { db } = fakeDb([[], [], [], []]);
    expect((await listPendingProposals(WS, db)).profile).toBeNull();
  });
});
