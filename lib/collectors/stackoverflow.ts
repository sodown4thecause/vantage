import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type { Collector, CollectorContext } from "@/lib/collectors/types";
import { withCost } from "@/lib/costs/meter";
import type { NewDocument } from "@/lib/db/schema";
import { fetchPublicText, isPublicHttpUrl } from "@/lib/http/public-fetch";

type Question = { question_id: number; link?: string; title?: string; body?: string; creation_date?: number; tags?: string[]; answer_count?: number; owner?: { display_name?: string } };
type Answer = { question_id: number; answer_id: number; body?: string; score?: number; owner?: { display_name?: string } };
type Page<T> = { items: T[]; has_more?: boolean; backoff?: number; quota_remaining?: number; error_id?: number };

async function apiPage<T>(ctx: CollectorContext, url: URL, action: string): Promise<Page<T>> {
  ctx.signal?.throwIfAborted();
  url.searchParams.set("site", "stackoverflow"); url.searchParams.set("filter", "withbody");
  url.searchParams.set("order", "desc"); url.searchParams.set("pagesize", "30");
  return withCost({ sourceKey: ctx.sourceId, workspaceId: ctx.workspaceId, provider: "stackexchange", action }, async () => {
    const { response, text } = await fetchPublicText(url.toString(), { signal: ctx.signal, cache: "no-store" }, 1_000_000, fetch, 30_000);
    if (!response.ok) throw new Error(`Stack Exchange API request failed (${response.status})`);
    const data = JSON.parse(text) as Page<T>;
    if (data?.error_id) throw new Error(`Stack Exchange API error ${data.error_id}`);
    if (!Array.isArray(data?.items)) throw new Error("Invalid Stack Exchange API response");
    ctx.signal?.throwIfAborted();
    return data;
  });
}

export const stackOverflowCollector: Collector = {
  name: "stackoverflow",
  async run(ctx) {
    ctx.signal?.throwIfAborted();
    const now = Math.floor(Date.now() / 1000);
    let state: { since?: number; until?: number; nextPage?: number; backoffUntil?: number } = {};
    try { const value = JSON.parse(ctx.cursor ?? "{}"); if (value && typeof value === "object") state = value; } catch { /* Legacy numeric cursor is accepted below. */ }
    const since = Number(state.since ?? ctx.cursor) || now - 72 * 3600;
    const until = state.until ?? now;
    let nextPage = state.nextPage ?? 1;
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(until) || until < since || until > now || !Number.isSafeInteger(nextPage) || nextPage < 1 || nextPage > Number.MAX_SAFE_INTEGER - 2) throw new Error("Invalid Stack Overflow pagination cursor");
    const query = typeof ctx.config.query === "string" ? ctx.config.query.trim() : "agent evaluation";
    if (!query || query.length > 500) throw new Error("Stack Overflow requires a query of 1-500 characters");
    if (typeof state.backoffUntil === "number" && state.backoffUntil > now) return {
      documents: [], partial: true, coverageReason: `Stack Overflow API backoff until ${state.backoffUntil}`,
      nextState: { cursor: ctx.cursor },
    };
    const maxPages = Math.min(2, Math.max(1, Math.floor(Number(ctx.config.maxPages) || 1)));
    const questions = new Map<number, Question>();
    let backoffUntil = 0;
    let quotaRemaining: number | undefined;
    let hasMore = false;
    // Keep the window fixed until its final page; the cap bounds each run's work.
    for (let count = 0; count < maxPages; count++) {
      const page = nextPage;
      const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
      url.searchParams.set("q", query); url.searchParams.set("sort", "activity"); url.searchParams.set("page", String(page));
      url.searchParams.set("min", String(since)); url.searchParams.set("max", String(until));
      if (typeof ctx.config.tagged === "string") url.searchParams.set("tagged", ctx.config.tagged.slice(0, 200));
      const data = await apiPage<Question>(ctx, url, "search_questions");
      for (const item of data.items) if (item && Number.isSafeInteger(item.question_id) && item.question_id > 0) questions.set(item.question_id, item);
      hasMore = data.has_more === true;
      nextPage = page + 1;
      quotaRemaining = data.quota_remaining;
      if (Number.isFinite(data.backoff) && Number(data.backoff) > 0) backoffUntil = Math.floor(Date.now() / 1000) + Math.ceil(Number(data.backoff));
      if (backoffUntil || quotaRemaining === 0 || !hasMore || !data.items.length) break;
    }

    const replies = new Map<number, Array<{ id: string; text: string; url: string; author: string | null }>>();
    const ids = [...questions.keys()].slice(0, 5);
    // ponytail: one answer batch for five questions; expand only if research needs broader context.
    if (ctx.config.includeReplies === true && ids.length && !backoffUntil && quotaRemaining !== 0) {
      const url = new URL(`https://api.stackexchange.com/2.3/questions/${ids.join(";")}/answers`);
      url.searchParams.set("sort", "votes");
      const data = await apiPage<Answer>(ctx, url, "question_answers");
      if (Number.isFinite(data.backoff) && Number(data.backoff) > 0) backoffUntil = Math.floor(Date.now() / 1000) + Math.ceil(Number(data.backoff));
      for (const answer of data.items) {
        if (!answer || !questions.has(answer.question_id) || !Number.isSafeInteger(answer.answer_id) || answer.answer_id < 1 || typeof answer.body !== "string") continue;
        const list = replies.get(answer.question_id) ?? [];
        if (list.length < 3) list.push({ id: String(answer.answer_id), text: answer.body.slice(0, 8000), url: `https://stackoverflow.com/a/${answer.answer_id}`, author: typeof answer.owner?.display_name === "string" ? answer.owner.display_name : null });
        replies.set(answer.question_id, list);
      }
    }
    const documents: NewDocument[] = [];
    for (const question of questions.values()) {
      if (typeof question.link !== "string" || !isPublicHttpUrl(question.link)) continue;
      const url = new URL(question.link);
      if (url.hostname !== "stackoverflow.com" || !/^\/questions\/\d+(?:\/|$)/.test(url.pathname)) continue;
      url.search = ""; url.hash = "";
      const urlCanonical = url.toString();
      const title = typeof question.title === "string" ? question.title : "";
      const contentMd = typeof question.body === "string" && question.body.trim() ? question.body : title;
      if (!contentMd) continue;
      const answerCount = Number.isSafeInteger(question.answer_count) && Number(question.answer_count) >= 0 ? Number(question.answer_count) : 0;
      const topReplies = replies.get(question.question_id) ?? [];
      documents.push({ workspaceId: ctx.workspaceId, sourceId: ctx.sourceId, platform: "stackoverflow", urlCanonical,
        title: title || null, contentMd, contentHash: contentHash("stackoverflow", urlCanonical, JSON.stringify({ contentMd, answerCount, topReplies })),
        postedAt: parseValidDate(typeof question.creation_date === "number" ? question.creation_date * 1000 : null),
        authorRef: typeof question.owner?.display_name === "string" ? question.owner.display_name : null,
        rawSnapshotRef: `stackoverflow:question:${question.question_id}`, metadata: { provider: "stackexchange", questionId: question.question_id,
          tags: Array.isArray(question.tags) ? question.tags.slice(0, 10) : [], answerCount,
          topReplies, threadContext: contentMd, rulesUrl: "https://stackoverflow.com/help/ai-policy" } });
    }
    return { documents, partial: hasMore,
      coverageReason: hasMore ? `Stack Overflow search window incomplete${backoffUntil ? "; API backoff" : quotaRemaining === 0 ? "; API quota exhausted" : ""}; resume at page ${nextPage}` : undefined,
      nextState: { cursor: JSON.stringify(hasMore ? { since, until, nextPage, backoffUntil } : { since: until, backoffUntil }) } };
  },
};
