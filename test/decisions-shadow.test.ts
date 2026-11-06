import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "off" as "off" | "shadow" | "on",
  ask: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/cf/env", () => ({ getDecisionMode: () => mocks.mode }));
vi.mock("@/lib/decisions/clef", () => ({ askClef: mocks.ask }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserts.push(values);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  }),
}));

import {
  PREFILTER_QUESTIONS,
  prefilterHydration,
  profileSummary,
  rankingQuestions,
  rankingState,
  recordRankingDecision,
} from "@/lib/decisions/shadow";

const WORKSPACE = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11";
const noul = (value: number) => ({
  model: "@cf/cloudflare/clef-flash",
  answers: { worth_fetching: { type: "noul" as const, noul: value } },
  inputTokens: 500,
});

const prefilter = () => prefilterHydration({
  workspaceId: WORKSPACE,
  documentId: "abc123",
  thread: "How do you evaluate a coding agent locally?",
  profileSummary: "A GTM tool for AI dev products.",
  hydrationCostUsd: 0.008,
});

beforeEach(() => {
  mocks.mode = "off";
  mocks.inserts = [];
  mocks.ask.mockReset().mockResolvedValue(noul(0.9));
});

describe("decision mode gate", () => {
  it("does nothing when the mode is off", async () => {
    expect(await prefilter()).toBeNull();
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe("hydration pre-filter", () => {
  it("records the verdict and the saved spend in shadow mode without skipping", async () => {
    mocks.mode = "shadow";
    mocks.ask.mockResolvedValue(noul(0.1));
    expect(await prefilter()).toEqual({ skip: false });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0]).toMatchObject({
      workspaceId: WORKSPACE,
      subjectKind: "document",
      subjectId: "abc123",
      mode: "shadow",
    });
    expect(mocks.inserts[0].answers).toMatchObject({ worth_fetching: 0.1, wouldSkip: true, savedUsd: 0.008 });
  });

  it("records no saving when the thread is worth fetching", async () => {
    mocks.mode = "shadow";
    await prefilter();
    expect(mocks.inserts[0].answers).toMatchObject({ wouldSkip: false, savedUsd: 0 });
  });

  it("skips the paid fetch only when the mode is on", async () => {
    mocks.mode = "on";
    mocks.ask.mockResolvedValue(noul(0.1));
    expect(await prefilter()).toEqual({ skip: true });
    mocks.ask.mockResolvedValue(noul(0.9));
    expect(await prefilter()).toEqual({ skip: false });
  });

  it("hydrates as before when the decision call fails", async () => {
    mocks.mode = "shadow";
    mocks.ask.mockResolvedValue(null);
    expect(await prefilter()).toBeNull();
    expect(mocks.inserts).toHaveLength(0);
  });

  it("asks one noul question with the flash model", async () => {
    mocks.mode = "shadow";
    await prefilter();
    expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({
      variant: "clef-flash",
      action: "clef_prefilter",
      questions: PREFILTER_QUESTIONS,
    }));
  });
});

describe("ranking shadow", () => {
  const ranking = () => recordRankingDecision({
    workspaceId: WORKSPACE,
    opportunityId: "11111111-1111-4111-8111-111111111111",
    thread: "Thread text",
    profileSummary: "Profile",
    rulesText: "Hacker News (https://news.ycombinator.com/newsguidelines.html)",
    segments: ["AI dev tool founders", "platform engineers"],
  });

  it("records the answers per opportunity without touching the score", async () => {
    mocks.mode = "shadow";
    mocks.ask.mockResolvedValue({
      model: "@cf/cloudflare/clef",
      answers: {
        fit: { type: "choice", choice: "segment_1", confidence: 0.7, probabilities: { segment_1: 0.7, not_fit: 0.3 } },
        answer_gap: { type: "noul", noul: 0.8 },
      },
      inputTokens: 900,
    });
    await ranking();
    expect(mocks.inserts[0]).toMatchObject({
      workspaceId: WORKSPACE,
      subjectKind: "opportunity",
      subjectId: "11111111-1111-4111-8111-111111111111",
      mode: "shadow",
    });
    expect(mocks.inserts[0].answers).toMatchObject({
      answer_gap: { type: "noul", noul: 0.8 },
      model: "@cf/cloudflare/clef",
    });
  });

  it("asks the five ranking questions and never asks about momentum", async () => {
    mocks.mode = "shadow";
    await ranking();
    const questions = mocks.ask.mock.calls[0][0].questions;
    expect(Object.keys(questions).sort()).toEqual(["answer_gap", "expertise_match", "fit", "rules_ok", "timing"]);
    expect(questions).not.toHaveProperty("momentum");
  });

  it("does nothing when the mode is off", async () => {
    await ranking();
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe("decision state", () => {
  it("puts the thread, profile and rules in that order", () => {
    expect(rankingState({ thread: "T", profileSummary: "P", rulesText: "R" }))
      .toBe("Thread:\nT\n\nWorkspace profile:\nP\n\nCommunity rules:\nR");
    expect(rankingState({ thread: "T", profileSummary: "P" })).toBe("Thread:\nT\n\nWorkspace profile:\nP");
  });

  it("summarises a profile without identifying anyone", () => {
    expect(profileSummary(null)).toBe("No workspace profile is saved.");
    expect(profileSummary({ productDescription: "A tool", targetCustomer: "Founders", topics: ["a", "b"] }))
      .toBe("A tool\nTarget customer: Founders\nTopics: a, b");
  });

  it("offers the ICP segments plus not_fit as the fit choices", () => {
    const fit = rankingQuestions(["one", "two"]).fit;
    expect(fit.type).toBe("choice");
    if (fit.type === "choice") expect(Object.keys(fit.criteria)).toEqual(["segment_1", "segment_2", "not_fit"]);
  });
});
