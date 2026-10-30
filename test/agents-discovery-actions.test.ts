import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorize: vi.fn(),
  confirm: vi.fn(),
  decideCompetitor: vi.fn(),
  decideKeyword: vi.fn(),
  decideRemoval: vi.fn(),
  queue: vi.fn(),
  ingest: vi.fn(),
  index: vi.fn(),
}));

vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: state.authorize }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/profile/index-profile", () => ({ indexSavedProfile: state.index }));
vi.mock("@/lib/db/client", () => ({ getDb: () => { throw new Error("actions must reach the database only through apply.ts"); } }));
vi.mock("@/lib/agents/discovery/apply", () => ({
  confirmProfileProposal: state.confirm,
  decideCompetitor: state.decideCompetitor,
  decideKeyword: state.decideKeyword,
  decideSourceRemoval: state.decideRemoval,
  queueTermSource: state.queue,
  ingestReviewedSources: state.ingest,
}));

import {
  confirmProposedProfile,
  decideCompetitorProposal,
  decideKeywordProposal,
  decideSourceRemovalProposal,
} from "@/lib/agents/discovery/actions";

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  for (const mock of Object.values(state)) mock.mockReset();
  state.authorize.mockResolvedValue({ ok: true, userId: "u" });
  state.confirm.mockResolvedValue({ ok: true, version: 2, profileId: "pid" });
  state.index.mockResolvedValue(undefined);
  state.decideCompetitor.mockResolvedValue({ ok: true, value: "syften.com" });
  state.decideKeyword.mockResolvedValue({ ok: true, value: "syften alternative" });
  state.decideRemoval.mockResolvedValue({ ok: true });
  state.queue.mockResolvedValue({ queued: true });
  state.ingest.mockResolvedValue({ ingested: [], waiting: [] });
});

describe("discovery server actions", () => {
  it("authorise the workspace first and touch nothing when refused", async () => {
    state.authorize.mockResolvedValue({ ok: false, status: 403, error: "forbidden" });
    const results = await Promise.all([
      confirmProposedProfile(WS, ID),
      decideCompetitorProposal(WS, ID, "accepted"),
      decideKeywordProposal(WS, ID, "accepted"),
      decideSourceRemovalProposal(WS, ID, "accepted"),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, message: "Unable to update this workspace." });
    for (const name of ["confirm", "decideCompetitor", "decideKeyword", "decideRemoval", "queue", "ingest", "index"] as const) expect(state[name]).not.toHaveBeenCalled();
  });

  it("reject ids that are not UUIDs before querying", async () => {
    expect(await confirmProposedProfile(WS, "not-a-uuid")).toEqual({ ok: false, message: "Unable to update this workspace." });
    expect(await decideCompetitorProposal("nope", ID, "accepted")).toEqual({ ok: false, message: "Unable to update this workspace." });
    expect(state.authorize).not.toHaveBeenCalled();
  });

  it("confirm the profile for the authorised workspace and index it like any saved profile", async () => {
    expect(await confirmProposedProfile(WS, ID)).toEqual({ ok: true, message: "Profile saved." });
    expect(state.confirm).toHaveBeenCalledWith(WS, ID);
    expect(state.index).toHaveBeenCalledWith(WS, "pid");
  });

  it("keep the saved profile even when indexing it fails", async () => {
    state.index.mockRejectedValue(new Error("queue down"));
    expect(await confirmProposedProfile(WS, ID)).toEqual({ ok: true, message: "Profile saved." });
  });

  it("queue a gated source search when the owner accepts a keyword or competitor, and ingest what passes", async () => {
    await decideKeywordProposal(WS, ID, "accepted");
    expect(state.queue).toHaveBeenCalledWith(WS, "syften alternative");
    expect(state.ingest).toHaveBeenCalledWith(WS);

    state.queue.mockClear();
    await decideCompetitorProposal(WS, ID, "accepted");
    expect(state.queue).toHaveBeenCalledWith(WS, "syften");
  });

  it("tell the owner to confirm the profile first, and queue nothing, when a term is accepted too early", async () => {
    state.decideKeyword.mockResolvedValue({ ok: false, reason: "profile_required" });
    state.decideCompetitor.mockResolvedValue({ ok: false, reason: "profile_required" });
    const expected = { ok: false, message: "Confirm your profile first, then accept this suggestion." };
    expect(await decideKeywordProposal(WS, ID, "accepted")).toEqual(expected);
    expect(await decideCompetitorProposal(WS, ID, "accepted")).toEqual(expected);
    expect(state.queue).not.toHaveBeenCalled();
    expect(state.ingest).not.toHaveBeenCalled();
  });

  it("index the profile version an accepted term created, best effort", async () => {
    state.decideKeyword.mockResolvedValue({ ok: true, value: "syften alternative", profileId: "pid2" });
    state.index.mockRejectedValue(new Error("queue down"));
    expect(await decideKeywordProposal(WS, ID, "accepted")).toEqual({ ok: true, message: "Keyword added." });
    expect(state.index).toHaveBeenCalledWith(WS, "pid2");
  });

  it("queue nothing when the owner rejects", async () => {
    await decideKeywordProposal(WS, ID, "rejected");
    await decideCompetitorProposal(WS, ID, "rejected");
    expect(state.queue).not.toHaveBeenCalled();
    expect(state.ingest).not.toHaveBeenCalled();
  });

  it("say so plainly when the proposal is gone or already decided", async () => {
    state.decideKeyword.mockResolvedValue({ ok: false });
    expect(await decideKeywordProposal(WS, ID, "accepted")).toEqual({ ok: false, message: "That suggestion has already been handled." });
  });

  it("return a generic message when applying fails", async () => {
    state.confirm.mockRejectedValue(new Error("db exploded: secret detail"));
    expect(await confirmProposedProfile(WS, ID)).toEqual({ ok: false, message: "Something went wrong. Please try again." });
  });

  it("pause a noisy source only on the owner's say-so", async () => {
    expect(await decideSourceRemovalProposal(WS, ID, "accepted")).toEqual({ ok: true, message: "Source paused." });
    expect(state.decideRemoval).toHaveBeenCalledWith(WS, ID, "accepted");
  });
});
