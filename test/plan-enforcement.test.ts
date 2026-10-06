import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allow: 0,
  consumed: 0,
  inserts: 0,
  existing: false,
  docs: [] as Array<Record<string, unknown>>,
  keywordError: false,
}));

function chain(rows: unknown[] | ((ordered: boolean) => unknown[])) {
  let ordered = false;
  const get = () => (typeof rows === "function" ? rows(ordered) : rows);
  const node: Record<string, unknown> = {};
  for (const name of ["from", "where", "innerJoin", "set", "values", "onConflictDoNothing"]) node[name] = () => node;
  node.orderBy = () => { ordered = true; return node; };
  node.limit = async () => get();
  node.returning = async () => { state.inserts++; return [{ id: `opp-${state.inserts}` }]; };
  node.then = (resolve: (value: unknown) => unknown) => Promise.resolve(get()).then(resolve);
  return node;
}

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => chain((ordered) => (ordered ? state.docs : state.existing ? [{ id: "existing" }] : [])),
    update: () => chain([]),
    delete: () => chain([]),
    insert: () => chain([]),
  }),
}));
vi.mock("@/lib/profile/repository", () => ({
  getLatestMonitoringProfile: async () => ({ version: 1, productDescription: "Agent evaluation", targetCustomer: "Teams", topics: ["agent evaluation"], competitors: [] }),
  saveMonitoringProfile: vi.fn(async () => {
    if (state.keywordError) throw new PlanLimitError("keywords", 5, "Your Free plan allows 5 keywords. Upgrade for more.");
    return { id: "p" };
  }),
}));
vi.mock("@/lib/learning/repository", () => ({ getActivePreferenceModel: async () => null }));
vi.mock("@/lib/plans/limits", () => ({
  consume: async () => {
    if (state.allow > state.consumed) { state.consumed++; return { allowed: true, consumed: 1, used: state.consumed, limit: state.allow, remaining: 0 }; }
    return { allowed: false, consumed: 0, used: state.consumed, limit: state.allow, remaining: 0 };
  },
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: async () => ({ ok: true, userId: "u" }) }));

import { PlanLimitError } from "@/lib/plans/types";
import { buildOpportunities } from "@/lib/opportunities/run";
import { POST } from "@/app/api/profile/route";

function liveDoc(id: string, title: string, platform = "hn") {
  const now = new Date();
  return {
    id, workspaceId: "ws", sourceId: "src", urlCanonical: `https://example.com/${id}`, platform, title,
    contentMd: `${title} body`, authorRef: null,
    postedAt: now, collectedAt: now, contentHash: id, metadata: { provider: "hn" },
  };
}

beforeEach(() => {
  state.allow = 0; state.consumed = 0; state.inserts = 0; state.existing = false; state.keywordError = false;
  state.docs = [liveDoc("a", "Agent evaluation alpha"), liveDoc("b", "Zebra billing question", "reddit"), liveDoc("c", "Quantum kitchen gadget", "rss")];
});

it("stops creating new leads at the daily cap and reports budget_limited instead of failing", async () => {
  state.allow = 0;
  const result = await buildOpportunities({ workspaceId: "ws" });
  expect(result.coverage).toBe("budget_limited");
  expect(result.budgetLimited).toBe(1);
  expect(result.upserted).toBe(0);
  expect(state.inserts).toBe(0);
});

it("creates the lead and reports no budget limit while a unit remains", async () => {
  state.allow = 1;
  const result = await buildOpportunities({ workspaceId: "ws" });
  expect(result.coverage).toBeUndefined();
  expect(result.upserted).toBe(1);
  expect(state.consumed).toBe(1);
});

it("does not spend the cap on leads that already exist", async () => {
  state.allow = 0;
  state.existing = true;
  const result = await buildOpportunities({ workspaceId: "ws" });
  expect(result.coverage).toBeUndefined();
  expect(state.consumed).toBe(0);
});

it("returns a clear 403 (not a 500) when the profile exceeds the keyword limit", async () => {
  state.keywordError = true;
  const response = await POST(new Request("https://example.com/api/profile", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: "ws", productUrl: "https://example.com", docsUrls: [], productDescription: "A tool",
      targetCustomer: "Founders", competitors: ["A", "B", "C"], topics: ["a", "b", "c", "d", "e", "f"],
    }),
  }));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Your Free plan allows 5 keywords. Upgrade for more.", code: "plan_limit_exceeded", fieldErrors: { topics: "Your Free plan allows 5 keywords. Upgrade for more." } });
});
