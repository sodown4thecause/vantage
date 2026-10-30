import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyAnswer,
  INTERVIEW_STEPS,
  localHourToUtc,
  nextStep,
  parseHour,
  parseList,
  promptFor,
  splitCommunities,
  stepForFieldErrors,
  toProfileInput,
  type InterviewAnswers,
} from "@/lib/onboarding/interview";
import type { MonitoringProfileView } from "@/lib/profile/types";

const WS = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  auth: { ok: true, userId: "user-a" } as { ok: true; userId: string } | { ok: false; status: 401 | 403; error: string },
  conversations: [] as Array<{ id: string; workspaceId: string; title: string; messages: Array<{ id: string; role: "user" | "assistant"; content: string; parts: Record<string, unknown>; status: string; creditsUsed: number; createdAt: string }> }>,
  saved: [] as unknown[],
  digestHours: [] as number[],
  indexed: [] as string[],
  saveError: null as Error | null,
  failCompletion: false,
  failFirstTurn: false,
  profiles: {} as Record<string, { id: string }>,
  derived: null as Record<string, unknown> | null,
  skipped: null as { topics: string[]; reasons: string[]; message: string } | null,
}));

vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: vi.fn(async () => state.auth) }));
vi.mock("@/lib/profile/index-profile", () => ({ indexSavedProfile: vi.fn(async (_ws: string, id: string) => { state.indexed.push(id); }) }));
vi.mock("@/lib/digest/preferences", () => ({ setDigestSchedule: vi.fn(async (_ws: string, schedule: { hourUtc: number }) => { state.digestHours.push(schedule.hourUtc); }) }));
vi.mock("@/lib/onboarding/derive", () => ({ deriveProfileFromUrl: vi.fn(async () => state.derived) }));
vi.mock("@/lib/profile/repository", () => ({
  getLatestMonitoringProfile: vi.fn(async () => null),
  saveMonitoringProfile: vi.fn(async (args: { workspaceId: string; input: unknown; profileId: string }) => {
    const key = `${args.workspaceId}:${args.profileId}`;
    if (state.profiles[key]) return state.profiles[key];
    if (state.saveError) throw state.saveError;
    state.saved.push(args);
    return state.profiles[key] = { id: "profile-1", ...(state.skipped ? { skippedSources: state.skipped } : {}) };
  }),
}));
vi.mock("@/lib/seo-agent/conversations", () => {
  class ConversationNotFoundError extends Error {}
  const find = (workspaceId: string, id: string) => state.conversations.find((c) => c.id === id && c.workspaceId === workspaceId);
  return {
    ConversationNotFoundError,
    appendTurn: async (workspaceId: string, conversation: { title: string }, user: { content: string }, assistant: { content: string; parts: Record<string, unknown> }) => {
      if (state.failFirstTurn) throw new Error("first turn write failed");
      const id = crypto.randomUUID();
      state.conversations.push({ id, workspaceId, title: conversation.title, messages: [
        { id: crypto.randomUUID(), role: "user", content: user.content, parts: {}, status: "complete", creditsUsed: 0, createdAt: "" },
        { id: crypto.randomUUID(), role: "assistant", ...assistant, status: "complete", creditsUsed: 0, createdAt: "" },
      ] });
      return { id };
    },
    createConversation: async (workspaceId: string, title: string) => {
      const id = crypto.randomUUID();
      state.conversations.push({ id, workspaceId, title, messages: [] });
      return { id };
    },
    getConversation: async (workspaceId: string, id: string) => find(workspaceId, id) ?? null,
    listConversations: async (workspaceId: string, limit: number, kind?: string) => state.conversations.filter((c) => c.workspaceId === workspaceId
      && (kind !== "interview" || c.messages.some((m) => JSON.stringify(m.parts).includes('"tool":"onboarding_interview"')))).reverse().slice(0, limit)
      .map((c) => ({ id: c.id, title: c.title, updatedAt: "" })),
    appendMessage: async (workspaceId: string, id: string, msg: { role: "user" | "assistant"; content: string; parts?: Record<string, unknown> }) => {
      if (state.failCompletion && msg.content.startsWith("You’re all set")) throw new Error("completion write failed");
      const conversation = find(workspaceId, id);
      if (!conversation) throw new ConversationNotFoundError();
      conversation.messages.push({ id: crypto.randomUUID(), status: "complete", creditsUsed: 0, createdAt: "", parts: {}, ...msg });
      return { id: "m" };
    },
  };
});

import { POST } from "@/app/api/workspace/interview/route";
import { findResumableInterview } from "@/lib/onboarding/interview-store";
import { saveMonitoringProfile } from "@/lib/profile/repository";

const ANSWERS = [
  "example.com",
  "Invoicing for tradies that chases late payments automatically.",
  "Sole-trader electricians and plumbers",
  "Xero, MYOB, spreadsheets",
  "r/AusFinance, Whirlpool",
  "late invoices, chasing payments",
  "8am",
];

const turn = async (answer: string, conversationId?: string, timeZone = "Australia/Sydney") => {
  const response = await POST(new Request("http://test/api/workspace/interview", {
    method: "POST", body: JSON.stringify({ workspaceId: WS, conversationId, answer, timeZone }),
  }));
  return { status: response.status, body: await response.json() as { conversationId: string; complete: boolean; message: string; rejected?: boolean; prompt?: { step: string; suggestions: unknown[] } } };
};

beforeEach(() => {
  state.auth = { ok: true, userId: "user-a" };
  state.conversations = [];
  state.saved = [];
  state.digestHours = [];
  state.indexed = [];
  state.saveError = null;
  state.failCompletion = false;
  state.failFirstTurn = false;
  state.profiles = {};
  state.derived = null;
  state.skipped = null;
  vi.mocked(saveMonitoringProfile).mockClear();
});

const DRAFT = {
  productDescription: "Invoicing for tradies that chases late payments automatically.",
  targetCustomer: "Sole-trader electricians and plumbers",
  competitors: ["Xero", "MYOB", "spreadsheets"],
  communities: ["r/AusFinance"],
  keywords: ["late invoices", "chasing payments"],
};

const confirmTurn = async (conversationId: string, confirm: Record<string, string>) => {
  const response = await POST(new Request("http://test/api/workspace/interview", {
    method: "POST", body: JSON.stringify({ workspaceId: WS, conversationId, confirm, timeZone: "Australia/Brisbane" }),
  }));
  return { status: response.status, body: await response.json() as { complete: boolean; rejected?: boolean; message: string; answers?: Record<string, unknown>; draft?: unknown; prompt?: { step: string } } };
};

describe("URL-first interview", () => {
  it("drafts the profile from the website and shows it as one card to confirm", async () => {
    state.derived = DRAFT;
    const first = await turn("example.com");
    expect(first.body.message).toContain("drafted your profile");
    expect(first.body).toMatchObject({ complete: false, prompt: { step: "productDescription" } });
    expect((first.body as unknown as { draft: unknown }).draft).toEqual(DRAFT);

    const all = await confirmTurn(first.body.conversationId, {
      productDescription: DRAFT.productDescription, targetCustomer: "Electricians", competitors: "Xero, MYOB, spreadsheets",
      communities: "", keywords: "late invoices",
    });
    expect(all.body).toMatchObject({ complete: false, prompt: { step: "digest" } });
    expect(all.body.answers).toMatchObject({ targetCustomer: "Electricians", communities: [], keywords: ["late invoices"] });
    const done = await turn("7am", first.body.conversationId, "Australia/Brisbane");
    expect(done.body.complete).toBe(true);
    expect(state.saved).toHaveLength(1);
    expect(state.digestHours).toEqual([21]);
  });

  it("resumes from the first unconfirmed field after the owner leaves halfway", async () => {
    state.derived = DRAFT;
    const first = await turn("example.com");
    await confirmTurn(first.body.conversationId, { productDescription: DRAFT.productDescription });
    await confirmTurn(first.body.conversationId, { targetCustomer: DRAFT.targetCustomer });
    const resumed = await findResumableInterview(WS);
    expect(nextStep(resumed!.state.answers)).toBe("competitors");
    expect(resumed!.state.draft).toEqual(DRAFT);
    expect(resumed!.turns.at(-2)).toEqual({ role: "user", content: "Confirmed: Ideal customer" });
  });

  it("rejects an invalid edit without storing any of the submitted fields", async () => {
    state.derived = DRAFT;
    const first = await turn("example.com");
    const bad = await confirmTurn(first.body.conversationId, { productDescription: DRAFT.productDescription, competitors: "Xero" });
    expect(bad.body).toMatchObject({ rejected: true, prompt: { step: "competitors" } });
    expect(nextStep((await findResumableInterview(WS))!.state.answers)).toBe("productDescription");
  });

  it("falls back to one question per field when the site can't be drafted", async () => {
    const first = await turn("example.com");
    expect(first.body.message).toContain("what does example.com do");
    expect((first.body as unknown as { draft?: unknown }).draft).toBeUndefined();
    expect((await confirmTurn(first.body.conversationId, { productDescription: "Something useful here." })).status).toBe(400);
  });
});

describe("interview step logic", () => {
  it("discovers setup by its card even when research uses the setup title", async () => {
    const first = await turn(ANSWERS[0]!);
    const setup = state.conversations[0]!;
    setup.title = "Renamed setup";
    const researchId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    state.conversations.push({ ...setup, id: researchId, title: "Product setup interview",
      messages: setup.messages.map((message) => ({ ...message, parts: {}, content: "Ordinary research" })),
    });
    expect((await findResumableInterview(WS))?.id).toBe(first.body.conversationId);
    expect((await turn("Continue", researchId)).status).toBe(404);
    expect(state.saved).toHaveLength(0);
  });
  it("asks the steps in order and resumes from the first unanswered one", () => {
    expect(nextStep({})).toBe("productUrl");
    expect(nextStep({ productUrl: "https://example.com/", productDescription: "Does things well." })).toBe("targetCustomer");
    expect(nextStep({ productUrl: "x", productDescription: "x", targetCustomer: "x", competitors: ["a", "b", "c"], communities: [] })).toBe("keywords");
    const all: InterviewAnswers = { productUrl: "x", productDescription: "x", targetCustomer: "x", competitors: [], communities: [], keywords: ["k"], digest: null };
    expect(nextStep(all)).toBeNull();
  });

  it("always offers exactly three suggested prompts", () => {
    for (const step of INTERVIEW_STEPS) {
      expect(promptFor(step, { competitors: ["Xero", "MYOB", "Sheets"] }).suggestions).toHaveLength(3);
      expect(promptFor(step, {}).suggestions).toHaveLength(3);
    }
  });

  it("validates answers per step without mutating the input", () => {
    const answers: InterviewAnswers = {};
    expect(applyAnswer(answers, "productUrl", "localhost")).toMatchObject({ ok: false });
    expect(applyAnswer(answers, "productUrl", "javascript:alert(1)")).toMatchObject({ ok: false });
    expect(applyAnswer(answers, "productUrl", "example.com")).toEqual({ ok: true, answers: { productUrl: "https://example.com/" } });
    expect(answers).toEqual({});
    expect(applyAnswer({}, "competitors", "Xero, MYOB")).toMatchObject({ ok: false });
    expect(applyAnswer({}, "competitors", "a, b, c, d, e, f")).toMatchObject({ ok: false });
    expect(applyAnswer({}, "communities", "skip")).toEqual({ ok: true, answers: { communities: [] } });
    expect(applyAnswer({}, "digest", "Skip, I'll set this later")).toEqual({ ok: true, answers: { digest: null } });
    expect(applyAnswer({}, "digest", "whenever")).toMatchObject({ ok: false });
    expect(applyAnswer({}, "communities", "No Code Founders, r/nocode")).toEqual({ ok: true, answers: { communities: ["No Code Founders", "r/nocode"] } });
    expect(applyAnswer({}, "communities", "Not sure yet")).toEqual({ ok: true, answers: { communities: [] } });
    expect(applyAnswer({}, "productDescription", "x".repeat(7_000))).toMatchObject({ ok: true });
  });

  it("re-reads a new website instead of keeping the old site's manual material", () => {
    const current = { productUrl: "https://old.example/", docsUrls: [], productMaterialStatus: "manual", productMaterialText: "Old README" } as unknown as MonitoringProfileView;
    expect(toProfileInput({ productUrl: "https://old.example/" }, current)).toMatchObject({ forceManualMaterial: true, productMaterialManual: "Old README" });
    expect(toProfileInput({ productUrl: "https://new.example/" }, current)).toMatchObject({ forceManualMaterial: false, productMaterialManual: undefined });
  });

  it("parses lists and hours", () => {
    expect(parseList("Xero, xero; MYOB\n Sheets ")).toEqual(["Xero", "MYOB", "Sheets"]);
    expect([parseHour("8am"), parseHour("8:30 pm"), parseHour("17:00"), parseHour("12am"), parseHour("noon"), parseHour("25")]).toEqual([8, 20, 17, 0, 12, null]);
  });

  it("converts a local digest hour to UTC", () => {
    const winter = new Date("2026-07-01T00:00:00Z");
    expect(localHourToUtc(8, "Australia/Sydney", winter)).toBe(22);
    expect(localHourToUtc(8, "Australia/Adelaide", winter)).toBe(22);
    expect(localHourToUtc(8, "UTC", winter)).toBe(8);
    expect(applyAnswer({}, "digest", "8am", { timeZone: "Not/AZone", now: winter })).toEqual({ ok: true, answers: { digest: { localHour: 8, timeZone: "UTC", hourUtc: 8 } } });
  });

  it("builds the onboarding payload, folding communities into the customer and keeping docs links", () => {
    const current = { docsUrls: ["https://example.com/docs"], productMaterialStatus: "ok", productMaterialText: "" } as unknown as MonitoringProfileView;
    const input = toProfileInput({
      productUrl: "https://example.com/", productDescription: "Does things", targetCustomer: "Plumbers\n\nCommunities they use: old.",
      competitors: ["a", "b", "c"], communities: ["r/plumbing"], keywords: ["leaks"], digest: null,
    }, current);
    expect(input).toEqual({
      productUrl: "https://example.com/", docsUrls: ["https://example.com/docs"], productDescription: "Does things",
      targetCustomer: "Plumbers\n\nCommunities they use: r/plumbing.", competitors: ["a", "b", "c"], topics: ["leaks"],
      productMaterialManual: undefined, forceManualMaterial: false,
    });
    expect(splitCommunities(input.targetCustomer)).toEqual({ customer: "Plumbers", communities: ["r/plumbing"] });
  });

  it("maps a profile validation error back to the step to ask again", () => {
    const retry = stepForFieldErrors({ productUrl: "x", keywords: ["k"] }, { topics: "Too many" });
    expect(retry).toEqual({ step: "keywords", error: "Too many", answers: { productUrl: "x" } });
  });
});

describe("interview route", () => {
  it("runs the full interview one question per turn and saves through the profile repository", async () => {
    let conversationId: string | undefined;
    for (const [index, answer] of ANSWERS.entries()) {
      const { status, body } = await turn(answer, conversationId);
      expect(status).toBe(200);
      conversationId = body.conversationId;
      if (index < ANSWERS.length - 1) {
        expect(body).toMatchObject({ complete: false, prompt: { step: INTERVIEW_STEPS[index + 1] } });
        expect(body.prompt!.suggestions).toHaveLength(3);
        expect(saveMonitoringProfile).not.toHaveBeenCalled();
      } else {
        expect(body.complete).toBe(true);
        expect(body.message).toContain("You write every reply");
      }
    }
    expect(state.saved).toEqual([{
      workspaceId: WS,
      profileId: conversationId,
      input: {
        productUrl: "https://example.com/", docsUrls: [],
        productDescription: "Invoicing for tradies that chases late payments automatically.",
        targetCustomer: "Sole-trader electricians and plumbers\n\nCommunities they use: r/AusFinance, Whirlpool.",
        competitors: ["Xero", "MYOB", "spreadsheets"], topics: ["late invoices", "chasing payments"],
        productMaterialManual: undefined, forceManualMaterial: false,
      },
    }]);
    expect(state.indexed).toEqual(["profile-1"]);
    expect(state.digestHours).toHaveLength(1);
    expect(await findResumableInterview(WS)).toBeNull();
    expect((await turn("again", conversationId)).status).toBe(409);
  });

  it("resumes from the next unanswered question after the owner leaves", async () => {
    const first = await turn(ANSWERS[0]!);
    await turn(ANSWERS[1]!, first.body.conversationId);
    const resumed = await findResumableInterview(WS);
    expect(resumed).toMatchObject({ id: first.body.conversationId, state: { complete: false } });
    expect(nextStep(resumed!.state.answers)).toBe("targetCustomer");
    expect(resumed!.turns).toHaveLength(4);
  });

  it("leaves no unmarked conversation when the first atomic turn fails", async () => {
    state.failFirstTurn = true;
    expect((await turn(ANSWERS[0]!)).status).toBe(500);
    expect(state.conversations).toHaveLength(0);
    state.failFirstTurn = false;
    const retry = await turn(ANSWERS[0]!);
    expect(retry.status).toBe(200);
    expect(await findResumableInterview(WS)).toMatchObject({
      id: retry.body.conversationId, state: { answers: { productUrl: "https://example.com/" }, complete: false },
    });
    expect(state.conversations[0]!.messages[1]!.parts).toMatchObject({ cards: [{ tool: "onboarding_interview" }] });
  });

  it("rejects an invalid answer without storing it", async () => {
    const first = await turn("not a url");
    expect(first.body).toMatchObject({ rejected: true, prompt: { step: "productUrl" } });
    expect(state.conversations).toHaveLength(0);
  });

  it("refuses a workspace the user does not own before reading or writing", async () => {
    state.auth = { ok: false, status: 403, error: "forbidden" };
    expect((await turn(ANSWERS[0]!)).status).toBe(403);
    expect(state.conversations).toHaveLength(0);
  });

  it("will not continue a conversation from another workspace", async () => {
    state.conversations.push({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", workspaceId: "22222222-2222-4222-8222-222222222222", title: "Product setup interview", messages: [] });
    expect((await turn(ANSWERS[0]!, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).status).toBe(404);
  });

  it("finishes once the profile is saved even if indexing fails, so a retry cannot save twice", async () => {
    const { indexSavedProfile } = await import("@/lib/profile/index-profile");
    vi.mocked(indexSavedProfile).mockRejectedValueOnce(new Error("queue down"));
    let conversationId: string | undefined;
    let last: Awaited<ReturnType<typeof turn>> | undefined;
    for (const answer of ANSWERS) { last = await turn(answer, conversationId); conversationId = last.body.conversationId; }
    expect(last!.body.complete).toBe(true);
    expect((await turn("again", conversationId)).status).toBe(409);
    expect(state.saved).toHaveLength(1);
    expect(state.digestHours).toHaveLength(1);
  });

  it("reports a failed digest write without claiming that the chosen time was saved", async () => {
    const { setDigestSchedule } = await import("@/lib/digest/preferences");
    vi.mocked(setDigestSchedule).mockRejectedValueOnce(new Error("db down"));
    let conversationId: string | undefined;
    let last: Awaited<ReturnType<typeof turn>> | undefined;
    for (const answer of ANSWERS) { last = await turn(answer, conversationId); conversationId = last.body.conversationId; }
    expect(last!.body.complete).toBe(false);
    expect(last!.body.message).toContain("couldn’t save your chosen digest time");
    expect(last!.body.message).not.toContain("Your daily digest is set for");
    expect(last!.body.message).toContain("Please set it under Daily digest");
    expect(state.saved).toHaveLength(1);
    expect((await turn("retry", conversationId)).body.complete).toBe(true);
    expect(state.saved).toHaveLength(1);
  });

  it("reuses the durable profile after a completion append failure and keeps the original final answer", async () => {
    let conversationId: string | undefined;
    for (const answer of ANSWERS.slice(0, -1)) conversationId = (await turn(answer, conversationId)).body.conversationId;
    state.failCompletion = true;
    expect((await turn("8am", conversationId)).status).toBe(500);
    expect(state.saved).toHaveLength(1);
    const resumed = await findResumableInterview(WS);
    expect(nextStep(resumed!.state.answers)).toBeNull();
    expect(resumed!.state.answers.digest).toMatchObject({ localHour: 8 });
    state.failCompletion = false;
    const retried = await turn("skip", conversationId);
    expect(retried.body.complete).toBe(true);
    expect(retried.body.message).toContain("8am Australia/Sydney");
    expect(state.saved).toHaveLength(1);
    expect(saveMonitoringProfile).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: WS, profileId: conversationId }));
    expect((await turn("again", conversationId)).status).toBe(409);
  });

  it("tells the owner in the final message which topics were skipped and why", async () => {
    state.skipped = { topics: ["ai", "tools"], reasons: ["Every query is generic."], message: 'We didn\u2019t set up default sources from these topics: "ai", "tools". Every query is generic.' };
    let conversationId: string | undefined;
    let last = { body: {} as Record<string, unknown>, status: 0 };
    for (const answer of ANSWERS) { last = await turn(answer, conversationId); conversationId = last.body.conversationId as string; }
    expect(last.body.complete).toBe(true);
    expect(String(last.body.message)).toContain('from these topics: "ai", "tools"');
  });

  it("keeps every answer when the save fails, so the next message retries", async () => {
    let conversationId: string | undefined;
    state.saveError = new Error("db down");
    for (const answer of ANSWERS) conversationId = (await turn(answer, conversationId)).body.conversationId;
    expect(state.saved).toHaveLength(0);
    state.saveError = null;
    const retry = await turn("try again", conversationId);
    expect(retry.body.complete).toBe(true);
    expect(state.saved).toHaveLength(1);
  });
});
