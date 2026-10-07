import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const costs = vi.hoisted(() => ({ events: [] as Record<string, unknown>[] }));
vi.mock("@/lib/costs/ledger", () => ({ recordCost: async (event: Record<string, unknown>) => costs.events.push(event) }));
vi.mock("@/lib/costs/prices", () => ({ getUnitCost: async () => 0 }));

import { githubCollector } from "@/lib/collectors/github";
import { stackOverflowCollector } from "@/lib/collectors/stackoverflow";

const ctx = { workspaceId: "workspace", sourceId: "source", config: { query: "agent evaluation", includeReplies: false } };
beforeEach(() => { costs.events = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function activityPage(url: URL, questions: Array<{ question_id: number; last_activity_date: number }>): Response {
  const min = Number(url.searchParams.get("min"));
  const max = Number(url.searchParams.get("max"));
  const size = Number(url.searchParams.get("pagesize")) || 30;
  const offset = ((Number(url.searchParams.get("page")) || 1) - 1) * size;
  const matches = questions.filter(question => question.last_activity_date >= min && question.last_activity_date <= max)
    .sort((a, b) => b.last_activity_date - a.last_activity_date || a.question_id - b.question_id);
  return Response.json({ items: matches.slice(offset, offset + size), has_more: matches.length > offset + size, quota_remaining: 100 });
}

describe("public developer collectors", () => {
  it("normalizes GitHub issue identity, original dates and zero-cost attribution", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ total_count: 1, incomplete_results: false, items: [{
      id: 42, number: 7, html_url: "https://github.com/acme/agent/issues/7", title: "Evaluation fails",
      body: "Cannot compare agent runs", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-06T12:00:00Z",
      user: { login: "builder" }, comments: 3, labels: [{ name: "bug" }],
    }] })));
    const result = await githubCollector.run(ctx);
    expect(result.documents[0]).toMatchObject({ platform: "github", urlCanonical: "https://github.com/acme/agent/issues/7", postedAt: new Date("2026-10-01T12:00:00Z"), authorRef: "builder", contentMd: "Cannot compare agent runs", metadata: { provider: "github", issueId: 42, commentCount: 3, topReplies: [] } });
    expect(costs.events[0]).toMatchObject({ sourceKey: "source", workspaceId: "workspace", provider: "github", unitCostUsd: 0, ok: true });
  });

  it("caps GitHub pagination and requests public issues only", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); urls.push(url);
      return Response.json({ total_count: 1000, incomplete_results: false, items: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, html_url: `https://github.com/acme/agent/issues/${i + 1}`, title: "Agent", body: "Problem" })) });
    });
    const result = await githubCollector.run({ ...ctx, config: { query: "agent", maxPages: 50 } });
    expect(urls).toHaveLength(2);
    expect(urls[0]?.searchParams.get("q")).toContain("is:public is:issue");
    expect(result.documents).toHaveLength(30);
    expect(result.partial).toBe(true);
  });

  it("keeps GitHub upstream incompleteness when no issues were accepted", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ total_count: 0, incomplete_results: true, items: [] }));
    const result = await githubCollector.run(ctx);
    expect(result.documents).toEqual([]);
    expect(result.partial).toBe(true);
  });

  it("preserves a successful empty result without fixtures", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ total_count: 0, items: [] }));
    expect((await githubCollector.run(ctx)).documents).toEqual([]);
    vi.stubGlobal("fetch", async () => Response.json({ items: [], has_more: false, quota_remaining: 100 }));
    expect((await stackOverflowCollector.run(ctx)).documents).toEqual([]);
  });

  it("stops before a request when aborted and reports an empty GitHub rate-limit deferral", async () => {
    const aborted = new AbortController(); aborted.abort();
    const request = vi.fn(async () => new Response(null, { status: 429 })); vi.stubGlobal("fetch", request);
    await expect(githubCollector.run({ ...ctx, signal: aborted.signal })).rejects.toThrow();
    await expect(stackOverflowCollector.run({ ...ctx, signal: aborted.signal })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    const limited = await githubCollector.run(ctx);
    expect(limited.documents).toEqual([]);
    expect(limited.partial).toBe(true);
    expect(limited.coverageReason).toMatch(/rate.limit/i);
    const deferred = await githubCollector.run({ ...ctx, cursor: limited.nextState?.cursor });
    expect(deferred.documents).toEqual([]);
    expect(deferred.partial).toBe(true);
    expect(deferred.nextState?.cursor).toBe(limited.nextState?.cursor);
    expect(request).toHaveBeenCalledTimes(1);
    expect(costs.events).toHaveLength(1);
    expect(costs.events[0]).toMatchObject({ provider: "github", unitCostUsd: 0, ok: false });
  });

  it("keeps accepted GitHub issues and resumes a throttled page after both upstream deadlines", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      urls.push(new URL(input));
      if (urls.length === 2) return new Response(null, { status: 429, headers: { "retry-after": "60", "x-ratelimit-reset": "1700000220" } });
      const ids = urls.length === 1 ? Array.from({ length: 30 }, (_, i) => i + 1) : [31];
      return Response.json({ total_count: 31, items: ids.map(id => ({ id, html_url: `https://github.com/acme/agent/issues/${id}`, body: `Question ${id}` })) });
    });
    const first = await githubCollector.run({ ...ctx, cursor: "1700000000", config: { query: "agent", maxPages: 2 } });
    expect(first.documents).toHaveLength(30);
    expect(first.partial).toBe(true);
    expect(first.coverageReason).toMatch(/rate.limit/i);
    expect(costs.events.map(event => [event.ok, event.unitCostUsd])).toEqual([[true, 0], [false, 0]]);
    clock.mockReturnValue(1_700_000_161_000);
    const deferred = await githubCollector.run({ ...ctx, cursor: first.nextState?.cursor, config: { query: "agent", maxPages: 2 } });
    expect(deferred.documents).toEqual([]);
    expect(deferred.partial).toBe(true);
    expect(deferred.nextState?.cursor).toBe(first.nextState?.cursor);
    expect(urls).toHaveLength(2);
    clock.mockReturnValue(1_700_000_221_000);
    const resumed = await githubCollector.run({ ...ctx, cursor: deferred.nextState?.cursor, config: { query: "agent", maxPages: 2 } });
    expect(resumed.documents.map(doc => doc.metadata?.issueId)).toEqual([31]);
    expect(urls[2]?.searchParams.get("page")).toBe("2");
    expect(urls[2]?.searchParams.get("q")).toBe(urls[1]?.searchParams.get("q"));
    expect(JSON.parse(resumed.nextState?.cursor as string).since).toBe(1_700_000_100);
    expect(resumed.partial).not.toBe(true);
    expect(costs.events).toHaveLength(3);
  });

  it("resumes the interrupted GitHub query and respects an HTTP-date retry-after on a secondary limit", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      urls.push(new URL(input));
      if (urls.length === 2) return new Response(null, { status: 403, headers: { "retry-after": new Date(1_700_000_190_000).toUTCString() } });
      const id = urls.length === 1 ? 1 : 2;
      return Response.json({ total_count: 1, items: [{ id, html_url: `https://github.com/acme/agent/issues/${id}`, body: `Question ${id}` }] });
    });
    const config = { queries: ["agents", "evaluation"], maxPages: 1 };
    const first = await githubCollector.run({ ...ctx, cursor: "1700000000", config });
    expect(first.documents.map(doc => doc.metadata?.issueId)).toEqual([1]);
    clock.mockReturnValue(1_700_000_180_000);
    expect((await githubCollector.run({ ...ctx, cursor: first.nextState?.cursor, config })).partial).toBe(true);
    expect(urls).toHaveLength(2);
    clock.mockReturnValue(1_700_000_191_000);
    const resumed = await githubCollector.run({ ...ctx, cursor: first.nextState?.cursor, config });
    expect(resumed.documents.map(doc => doc.metadata?.issueId)).toEqual([2]);
    expect(urls).toHaveLength(3);
    expect(urls[2]?.searchParams.get("q")).toBe(urls[1]?.searchParams.get("q"));
    expect(urls[2]?.searchParams.get("page")).toBe("1");
    expect(JSON.parse(resumed.nextState?.cursor as string).since).toBe(1_700_000_100);
  });

  it.each([
    { name: "shorter", queries: ["evaluation"] },
    { name: "reordered", queries: ["evaluation", "agents"] },
    { name: "replaced", queries: ["new tooling", "agents"] },
  ])("restarts a deferred GitHub scan for $name queries while retaining the upstream wait", async ({ queries }) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      urls.push(new URL(input));
      if (urls.length === 2) return new Response(null, { status: 429, headers: { "retry-after": "60" } });
      return Response.json({ total_count: 1, items: [{ id: urls.length, html_url: `https://github.com/acme/agent/issues/${urls.length}`, body: "Question" }] });
    });
    const first = await githubCollector.run({ ...ctx, cursor: "1700000000", config: { queries: ["agents", "evaluation"], lookbackHours: 1 } });
    expect(first.documents).toHaveLength(1);
    clock.mockReturnValue(1_700_000_120_000);
    const changed = await githubCollector.run({ ...ctx, cursor: first.nextState?.cursor, config: { queries, lookbackHours: 1 } });
    expect(changed.partial).toBe(true);
    expect(urls).toHaveLength(2);
    expect(costs.events).toHaveLength(2);
    clock.mockReturnValue(1_700_000_161_000);
    const resumed = await githubCollector.run({ ...ctx, cursor: changed.nextState?.cursor, config: { queries, lookbackHours: 1 } });
    expect(urls[2]?.searchParams.get("page")).toBe("1");
    expect(urls[2]?.searchParams.get("q")).toBe(`${queries[0]} is:public is:issue updated:>=${new Date(1_699_996_520_000).toISOString()} updated:<=${new Date(1_700_000_120_000).toISOString()}`);
    expect(JSON.parse(resumed.nextState?.cursor as string).since).toBe(1_700_000_120);
    expect(resumed.documents).toHaveLength(queries.length);
  });

  it("resumes GitHub progress when only surrounding query whitespace or config form changes", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      urls.push(new URL(input));
      if (urls.length === 2) return new Response(null, { status: 429, headers: { "retry-after": "60" } });
      return Response.json({ total_count: 31, items: [{ id: urls.length, html_url: `https://github.com/acme/agent/issues/${urls.length}`, body: "Question" }] });
    });
    const first = await githubCollector.run({ ...ctx, cursor: "1700000000", config: { query: " agent evaluation ", maxPages: 2 } });
    clock.mockReturnValue(1_700_000_161_000);
    await githubCollector.run({ ...ctx, cursor: first.nextState?.cursor, config: { queries: ["agent evaluation"], maxPages: 2 } });
    expect(urls).toHaveLength(3);
    expect(urls[2]?.searchParams.get("page")).toBe("2");
    expect(urls[2]?.searchParams.get("q")).toBe(urls[1]?.searchParams.get("q"));
  });

  it("restarts legacy GitHub deferrals that have no query binding", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_200_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => { urls.push(new URL(input)); return Response.json({ total_count: 0, items: [] }); });
    const cursor = JSON.stringify({ since: 1_700_000_000, until: 1_700_000_100, queryIndex: 1, nextPage: 2, deferUntil: 1_700_000_160 });
    await githubCollector.run({ ...ctx, cursor, config: { queries: ["new query"], lookbackHours: 1 } });
    expect(urls).toHaveLength(1);
    expect(urls[0]?.searchParams.get("page")).toBe("1");
    expect(urls[0]?.searchParams.get("q")).toContain(`updated:>=${new Date(1_699_996_600_000).toISOString()}`);
  });

  it("restarts page one when a deferred GitHub query is replaced", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      urls.push(new URL(input));
      if (urls.length === 2) return new Response(null, { status: 429, headers: { "retry-after": "60" } });
      return Response.json({ total_count: urls.length === 1 ? 31 : 1, items: [{ id: urls.length, html_url: `https://github.com/acme/agent/issues/${urls.length}`, body: "Question" }] });
    });
    const first = await githubCollector.run({ ...ctx, cursor: "1700000000", config: { query: "original", maxPages: 2 } });
    clock.mockReturnValue(1_700_000_161_000);
    await githubCollector.run({ ...ctx, cursor: first.nextState?.cursor, config: { query: "replacement", maxPages: 2, lookbackHours: 1 } });
    expect(urls).toHaveLength(3);
    expect(urls[2]?.searchParams.get("page")).toBe("1");
    expect(urls[2]?.searchParams.get("q")).toContain("replacement is:public");
    expect(urls[2]?.searchParams.get("q")).toContain(`updated:<=${new Date(1_700_000_161_000).toISOString()}`);
  });

  it("starts a changed GitHub query from lookback after a completed scan", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => { urls.push(new URL(input)); return Response.json({ items: [], total_count: 0 }); });
    const first = await githubCollector.run({ ...ctx, cursor: "1700000000", config: { query: "original", lookbackHours: 1 } });
    clock.mockReturnValue(1_700_000_200_000);
    await githubCollector.run({ ...ctx, cursor: first.nextState?.cursor, config: { query: "replacement", lookbackHours: 1 } });
    expect(urls[1]?.searchParams.get("q")).toBe(`replacement is:public is:issue updated:>=${new Date(1_699_996_600_000).toISOString()} updated:<=${new Date(1_700_000_200_000).toISOString()}`);
  });

  it.each(["github", "stackoverflow"] as const)("allows a %s API response beyond the free-page four-second deadline", async platform => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const deadline = new AbortController();
      if (milliseconds <= 4_000) deadline.abort(new DOMException("The provider needs more than four seconds", "TimeoutError"));
      return deadline.signal;
    });
    vi.stubGlobal("fetch", async () => Response.json(platform === "github"
      ? { total_count: 1, items: [{ id: 1, html_url: "https://github.com/acme/agent/issues/1", body: "Question" }] }
      : { has_more: false, items: [{ question_id: 1, link: "https://stackoverflow.com/questions/1/agent", body: "Question" }] }));
    const collector = platform === "github" ? githubCollector : stackOverflowCollector;
    expect((await collector.run(ctx)).documents).toHaveLength(1);
  });

  it("normalizes Stack Overflow bodies and never invents missing creation dates", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ has_more: false, quota_remaining: 100, items: [{ question_id: 101, link: "https://stackoverflow.com/questions/101/agent", title: "Agent &amp; eval", body: "<p>Need reproducible evaluation</p>", owner: { display_name: "Builder" }, tags: ["langchain"], answer_count: 2 }] }));
    const result = await stackOverflowCollector.run(ctx);
    expect(result.documents[0]).toMatchObject({ platform: "stackoverflow", urlCanonical: "https://stackoverflow.com/questions/101/agent", postedAt: null, contentMd: "<p>Need reproducible evaluation</p>", metadata: { provider: "stackexchange", questionId: 101, rulesUrl: "https://stackoverflow.com/help/ai-policy", topReplies: [] } });
  });

  it("creates new Stack Overflow evidence when the answer count changes without a body edit", async () => {
    let answerCount = 1;
    vi.stubGlobal("fetch", async () => Response.json({ has_more: false, items: [{ question_id: 101, link: "https://stackoverflow.com/questions/101/agent", body: "How do I compare runs?", answer_count: answerCount }] }));
    const first = (await stackOverflowCollector.run(ctx)).documents[0]!;
    answerCount = 2;
    const second = (await stackOverflowCollector.run(ctx)).documents[0]!;
    expect(second.contentMd).toBe(first.contentMd);
    expect(second.metadata?.answerCount).toBe(2);
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it("creates new Stack Overflow evidence when an existing top answer is edited", async () => {
    let reply = "Use a fixed dataset";
    vi.stubGlobal("fetch", async (input: string) => input.includes("/answers")
      ? Response.json({ has_more: false, items: [{ question_id: 101, answer_id: 201, body: reply, owner: { display_name: "Expert" } }] })
      : Response.json({ has_more: false, items: [{ question_id: 101, link: "https://stackoverflow.com/questions/101/agent", body: "How do I compare runs?", answer_count: 1 }] }));
    const config = { query: "agent", includeReplies: true };
    const first = (await stackOverflowCollector.run({ ...ctx, config })).documents[0]!;
    reply = "Use a fixed dataset and pin the model version";
    const second = (await stackOverflowCollector.run({ ...ctx, config })).documents[0]!;
    expect(second.contentMd).toBe(first.contentMd);
    expect(second.metadata?.topReplies).toMatchObject([{ id: "201", text: reply }]);
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it("persists Stack Exchange backoff and makes no extra pagination or reply calls", async () => {
    const request = vi.fn(async () => Response.json({ items: [], has_more: true, backoff: 60, quota_remaining: 100 })); vi.stubGlobal("fetch", request);
    const first = await stackOverflowCollector.run({ ...ctx, config: { query: "agent", maxPages: 2, includeReplies: true } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(first.partial).toBe(true);
    const deferred = await stackOverflowCollector.run({ ...ctx, cursor: first.nextState?.cursor });
    expect(deferred.documents).toEqual([]);
    expect(deferred.partial).toBe(true);
    expect(deferred.coverageReason).toMatch(/backoff/i);
    expect(deferred.nextState?.cursor).toBe(first.nextState?.cursor);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("resumes a bounded Stack Overflow activity range before advancing its watermark", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    const questions = Array.from({ length: 92 }, (_, i) => ({ question_id: 201 + i, link: `https://stackoverflow.com/questions/${201 + i}/evaluation`, body: `Evaluation question ${i}`, last_activity_date: 1_700_000_100 - i }));
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); urls.push(url);
      return activityPage(url, questions);
    });
    const first = await stackOverflowCollector.run({ ...ctx, cursor: "1700000000", config: { ...ctx.config, maxPages: 2 } });
    expect(first.documents.map(doc => doc.metadata?.questionId)).toEqual(Array.from({ length: 59 }, (_, i) => 201 + i));
    expect(first.partial).toBe(true);
    expect(first.coverageReason).toMatch(/incomplete/i);
    expect(urls.map(url => [url.searchParams.get("page"), url.searchParams.get("max")])).toEqual([["1", "1700000100"], ["1", "1700000071"]]);
    clock.mockReturnValue(1_700_000_500_000);
    const second = await stackOverflowCollector.run({ ...ctx, cursor: first.nextState?.cursor, config: { ...ctx.config, maxPages: 2 } });
    expect(second.documents.map(doc => doc.metadata?.questionId)).toEqual(Array.from({ length: 34 }, (_, i) => 259 + i));
    expect(second.partial).not.toBe(true);
    expect(urls.slice(2).map(url => [url.searchParams.get("page"), url.searchParams.get("min"), url.searchParams.get("max")])).toEqual([["1", "1700000000", "1700000042"], ["1", "1700000000", "1700000013"]]);
    clock.mockReturnValue(1_700_000_800_000);
    await stackOverflowCollector.run({ ...ctx, cursor: second.nextState?.cursor });
    expect([urls[4]?.searchParams.get("page"), urls[4]?.searchParams.get("min"), urls[4]?.searchParams.get("max")]).toEqual(["1", "1700000100", "1700000800"]);
  });

  it.each([
    { reason: "backoff", backoff: 60, quota: 100, resumeAt: 1_700_000_161_000 },
    { reason: "quota exhaustion", backoff: undefined, quota: 0, resumeAt: 1_700_086_500_000 },
  ])("resumes the same Stack Overflow activity boundary after $reason", async ({ backoff, quota, resumeAt }) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); urls.push(url);
      return Response.json(urls.length === 1
        ? { items: [{ question_id: 201, link: "https://stackoverflow.com/questions/201/evaluation", body: "First question", last_activity_date: 1_700_000_090 }], has_more: true, backoff, quota_remaining: quota }
        : { items: [{ question_id: 202, link: "https://stackoverflow.com/questions/202/evaluation", body: "Second question", last_activity_date: 1_700_000_080 }], has_more: false, quota_remaining: 100 });
    });
    const first = await stackOverflowCollector.run({ ...ctx, cursor: "1700000000", config: { ...ctx.config, maxPages: 2, includeReplies: true } });
    expect(urls).toHaveLength(1);
    expect(first.documents[0]?.metadata?.questionId).toBe(201);
    expect(first.partial).toBe(true);
    expect(first.coverageReason).toMatch(/backoff|quota/i);
    clock.mockReturnValue(resumeAt);
    const second = await stackOverflowCollector.run({ ...ctx, cursor: first.nextState?.cursor });
    expect(second.documents[0]?.metadata?.questionId).toBe(202);
    expect([urls[1]?.searchParams.get("page"), urls[1]?.searchParams.get("min"), urls[1]?.searchParams.get("max")]).toEqual(["1", "1700000000", "1700000090"]);
  });

  it("retains an incomplete Stack Overflow window after an empty non-final page", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); urls.push(url);
      return Response.json(urls.length === 1 ? { items: [], has_more: true, quota_remaining: 100 }
        : { items: [{ question_id: 202, link: "https://stackoverflow.com/questions/202/evaluation", body: "Later question" }], has_more: false, quota_remaining: 100 });
    });
    const first = await stackOverflowCollector.run({ ...ctx, cursor: "1700000000" });
    expect(first.documents).toEqual([]);
    expect(first.partial).toBe(true);
    expect(first.coverageReason).toMatch(/incomplete/i);
    const second = await stackOverflowCollector.run({ ...ctx, cursor: first.nextState?.cursor });
    expect(second.documents[0]?.metadata?.questionId).toBe(202);
    expect([urls[1]?.searchParams.get("page"), urls[1]?.searchParams.get("min"), urls[1]?.searchParams.get("max")]).toEqual(["1", "1700000000", "1700000100"]);
  });

  it("collects an unseen Stack Overflow question shifted forward after earlier questions leave the fixed window", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const questions = Array.from({ length: 31 }, (_, i) => ({ question_id: i + 1, link: `https://stackoverflow.com/questions/${i + 1}/evaluation`, body: `Question ${i + 1}`, creation_date: 1_699_000_000, last_activity_date: 1_700_000_100 - i }));
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => { const url = new URL(input); urls.push(url); return activityPage(url, questions); });
    const first = await stackOverflowCollector.run({ ...ctx, cursor: "1700000000" });
    expect(first.documents).toHaveLength(30);
    clock.mockReturnValue(1_700_000_500_000);
    for (const question of questions.slice(0, 30)) question.last_activity_date = 1_700_000_500;
    const second = await stackOverflowCollector.run({ ...ctx, cursor: first.nextState?.cursor });
    expect(second.documents.map(doc => doc.metadata?.questionId)).toEqual([31]);
    expect(second.documents[0]?.postedAt).toEqual(new Date(1_699_000_000_000));
    expect(second.partial).not.toBe(true);
    expect([urls[1]?.searchParams.get("page"), urls[1]?.searchParams.get("min"), urls[1]?.searchParams.get("max")]).toEqual(["1", "1700000000", "1700000071"]);
    expect(JSON.parse(second.nextState?.cursor as string).since).toBe(1_700_000_100);
  });

  it("keeps a saturated Stack Overflow timestamp boundary partial without increasing the call cap", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const questions = Array.from({ length: 31 }, (_, i) => ({ question_id: i + 1, link: `https://stackoverflow.com/questions/${i + 1}/evaluation`, body: `Question ${i + 1}`, last_activity_date: 1_700_000_050 }));
    let calls = 0;
    vi.stubGlobal("fetch", async (input: string) => { calls++; return activityPage(new URL(input), questions); });
    let cursor = "1700000000";
    for (let run = 0; run < 3; run++) {
      const before = calls;
      const result = await stackOverflowCollector.run({ ...ctx, cursor, config: { ...ctx.config, maxPages: 2 } });
      expect(calls - before).toBeLessThanOrEqual(2);
      expect(result.partial).toBe(true);
      expect(result.coverageReason).toMatch(/boundar|tie|progress/i);
      cursor = result.nextState?.cursor as string;
      expect(JSON.parse(cursor).since).toBe(1_700_000_000);
    }
  });

  it("retains the Stack Overflow activity boundary when a non-final page omits its timestamp", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); urls.push(url);
      return Response.json(urls.length === 1
        ? { items: [{ question_id: 101, link: "https://stackoverflow.com/questions/101/agent", body: "Question" }], has_more: true }
        : { items: url.searchParams.get("page") === "1" ? [{ question_id: 102, link: "https://stackoverflow.com/questions/102/agent", body: "Later question", last_activity_date: 1_700_000_090 }] : [], has_more: false });
    });
    const first = await stackOverflowCollector.run({ ...ctx, cursor: "1700000000" });
    expect(first.documents).toHaveLength(1);
    expect(first.partial).toBe(true);
    expect(first.coverageReason).toMatch(/timestamp|boundar/i);
    const second = await stackOverflowCollector.run({ ...ctx, cursor: first.nextState?.cursor });
    expect(second.documents[0]?.metadata?.questionId).toBe(102);
    expect(urls.map(url => url.searchParams.get("page"))).toEqual(["1", "1"]);
  });

  it("restarts a legacy Stack Overflow page-offset cursor at page one", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); urls.push(url);
      return Response.json({ has_more: false, items: url.searchParams.get("page") === "1" ? [{ question_id: 101, link: "https://stackoverflow.com/questions/101/agent", body: "Shifted question", last_activity_date: 1_700_000_090 }] : [] });
    });
    const cursor = JSON.stringify({ since: 1_700_000_000, until: 1_700_000_100, nextPage: 99, backoffUntil: 0 });
    const result = await stackOverflowCollector.run({ ...ctx, cursor });
    expect(result.documents[0]?.metadata?.questionId).toBe(101);
    expect(urls[0]?.searchParams.get("page")).toBe("1");
  });

  it("collects bounded existing Stack Overflow answers for contribution-gap research", async () => {
    vi.stubGlobal("fetch", async (input: string) => input.includes("/answers")
      ? Response.json({ items: [{ question_id: 101, answer_id: 201, body: "Use a fixed evaluation dataset", owner: { display_name: "Expert" }, score: 9 }], has_more: false })
      : Response.json({ items: [{ question_id: 101, link: "https://stackoverflow.com/questions/101/agent", title: "Agent evaluation", body: "How do I compare runs?" }], has_more: false }));
    const result = await stackOverflowCollector.run({ ...ctx, config: { query: "agent", includeReplies: true } });
    expect(result.documents[0]?.metadata).toMatchObject({ topReplies: [{ id: "201", text: "Use a fixed evaluation dataset", url: "https://stackoverflow.com/a/201" }] });
  });

  it("drops provider records with non-public or wrong-venue canonical URLs", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ total_count: 1, items: [{ id: 1, html_url: "http://127.0.0.1/secret", body: "bad" }] }));
    expect((await githubCollector.run(ctx)).documents).toEqual([]);
    vi.stubGlobal("fetch", async () => Response.json({ has_more: false, items: [{ question_id: 1, link: "https://example.com/questions/1", body: "bad" }] }));
    expect((await stackOverflowCollector.run(ctx)).documents).toEqual([]);
  });

  it.each([
    { name: "total count", payload: { items: [], total_count: "0" } },
    { name: "partial flag", payload: { items: [], incomplete_results: "false" } },
    { name: "null issue", payload: { items: [null] } },
    { name: "issue identity", payload: { items: [{ id: "42", body: "Question" }] } },
    { name: "issue body", payload: { items: [{ id: 42, body: { secret: "do-not-echo-this-token" } }] } },
    { name: "issue date", payload: { items: [{ id: 42, created_at: 1_700_000_000 }] } },
    { name: "comment count", payload: { items: [{ id: 42, comments: -1 }] } },
    { name: "author", payload: { items: [{ id: 42, user: { login: {} } }] } },
  ])("rejects malformed GitHub $name before normalization without leaking provider fields", async ({ payload }) => {
    vi.stubGlobal("fetch", async () => Response.json(payload));
    await expect(githubCollector.run(ctx)).rejects.toThrow(/^Invalid GitHub issues response$/);
    expect(costs.events.at(-1)).toMatchObject({ provider: "github", ok: false, unitCostUsd: 0 });
  });

  it.each([
    { name: "has-more flag", payload: { items: [], has_more: "false" } },
    { name: "backoff", payload: { items: [], backoff: "60" } },
    { name: "quota", payload: { items: [], quota_remaining: -1 } },
    { name: "null question", payload: { items: [null] } },
    { name: "question identity", payload: { items: [{ question_id: "101" }] } },
    { name: "question body", payload: { items: [{ question_id: 101, body: { secret: "do-not-echo-this-token" } }] } },
    { name: "creation date", payload: { items: [{ question_id: 101, creation_date: "yesterday" }] } },
    { name: "activity date", payload: { items: [{ question_id: 101, last_activity_date: {} }] } },
    { name: "answer count", payload: { items: [{ question_id: 101, answer_count: "3" }] } },
  ])("rejects malformed Stack Overflow $name before normalization without leaking provider fields", async ({ payload }) => {
    vi.stubGlobal("fetch", async () => Response.json(payload));
    await expect(stackOverflowCollector.run(ctx)).rejects.toThrow(/^Invalid Stack Exchange API response$/);
    expect(costs.events.at(-1)).toMatchObject({ provider: "stackexchange", ok: false, unitCostUsd: 0 });
  });

  it.each([
    { question_id: 101, answer_id: "201", body: "Reply" },
    { question_id: "101", answer_id: 201, body: "Reply" },
    { question_id: 101, answer_id: 201, body: { secret: "do-not-echo-this-token" } },
    { question_id: 101, answer_id: 201, body: "Reply", owner: { display_name: {} } },
  ])("rejects malformed captured Stack Overflow answer fields", async answer => {
    vi.stubGlobal("fetch", async (input: string) => input.includes("/answers")
      ? Response.json({ items: [answer], has_more: false })
      : Response.json({ items: [{ question_id: 101, link: "https://stackoverflow.com/questions/101/agent", body: "Question" }], has_more: false }));
    await expect(stackOverflowCollector.run({ ...ctx, config: { ...ctx.config, includeReplies: true } })).rejects.toThrow(/^Invalid Stack Exchange API response$/);
    expect(costs.events.at(-1)).toMatchObject({ provider: "stackexchange", action: "question_answers", ok: false, unitCostUsd: 0 });
  });
});
