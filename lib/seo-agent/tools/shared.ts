import { z } from "zod";

import { DataForSeoDeniedError } from "@/lib/dataforseo/gate";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";
import type { QuestionBudget } from "@/lib/seo-agent/budget";
import type { FollowUps, PlannedCall, ResultCard } from "@/lib/seo-agent/conversations";

/** Per-request state shared by the tools. The route reads cards, notices and followUps after the stream ends. */
export type ToolContext = {
  workspaceId: string;
  budget: QuestionBudget;
  brandDomains: string[];
  cards: ResultCard[];
  notices: string[];
  followUps?: FollowUps;
  signal?: AbortSignal;
};

export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_CHARS = 100;

const PAUSED = "SEO lookups are paused. Try again later.";
const CREDITS_EXHAUSTED = "You have used this month's SEO credits. They reset on the 1st (UTC); Pro includes more.";
// Owner-facing copy for the gate's denial codes. Every other denial reads as "paused".
const DENIAL_NOTICES: Record<string, string> = {
  not_configured: "SEO data is not set up yet.",
  credits_exhausted: CREDITS_EXHAUSTED,
};

/** Input fields shared by the tool definitions. Trimming here keeps the schema and the normalised input in step. */
export const domainField = z.string().trim().min(1).max(253);
export const keywordField = z.string().trim().min(1).max(MAX_KEYWORD_CHARS);
export const keywordsField = z.array(z.string().trim().max(MAX_KEYWORD_CHARS)).min(1).max(MAX_KEYWORDS);

/** Trims each keyword, drops blanks, and returns null when nothing usable or too many remain. */
export function normalizeKeywords(keywords: string[]): string[] | null {
  const list = keywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0);
  if (list.length === 0 || list.length > MAX_KEYWORDS) return null;
  if (list.some((keyword) => keyword.length > MAX_KEYWORD_CHARS)) return null;
  return list;
}

/** A short card title for a keyword list: the first three keywords, then how many more there are. */
export function keywordLabel(keywords: string[]): string {
  const shown = keywords.slice(0, 3).join(", ");
  return keywords.length > 3 ? `${shown} +${keywords.length - 3} more` : shown;
}

export function addNotice(ctx: ToolContext, message: string): void {
  if (!ctx.notices.includes(message)) ctx.notices.push(message);
}

/**
 * Maps a failed upstream call to the code the model sees and adds the matching owner notice. The caller refunds the
 * credits it reserved. Unknown errors are "failed" with no notice.
 */
export function failureCode(ctx: ToolContext, err: unknown): string {
  if (err instanceof DataForSeoDeniedError) {
    addNotice(ctx, DENIAL_NOTICES[err.code] ?? PAUSED);
    return err.code;
  }
  if (err instanceof PaidCallDeniedError) {
    addNotice(ctx, PAUSED);
    return err.code;
  }
  return "failed";
}

export function addCard(ctx: ToolContext, card: { tool: string; title: string; cached: boolean; data: unknown }): void {
  ctx.cards.push({
    tool: card.tool,
    title: card.title,
    fetchedAt: card.cached ? null : new Date().toISOString(),
    cached: card.cached,
    data: card.data,
  });
}

export type GatedCall<T> = {
  tool: string;
  title: string;
  /** The normalised input. An approved plan matches on this, so it must be exactly what the tool was called with. */
  input: Record<string, unknown>;
  credits: number;
  alwaysAsk?: boolean;
  /** Cache-only read. A hit never reserves credits. */
  peek: () => Promise<T | null>;
  fetch: () => Promise<{ value: T; cached: boolean }>;
};

/**
 * One paid lookup, in order: cache hit returns it free; otherwise reserve the budget (asking when it does not fit);
 * then fetch. A failure or a cached answer gives the reserved credits back.
 */
export async function runGated<T>(ctx: ToolContext, call: GatedCall<T>): Promise<unknown> {
  try {
    const hit = await call.peek();
    if (hit !== null) {
      addCard(ctx, { tool: call.tool, title: call.title, cached: true, data: hit });
      return hit;
    }
  } catch {
    return { error: "failed" };
  }

  const planned: PlannedCall = { tool: call.tool, input: call.input, credits: call.credits };
  if (ctx.budget.tryReserve(planned, call.alwaysAsk ?? false) === "ask") {
    return { status: "needs_approval", credits: call.credits };
  }

  try {
    const { value, cached } = await call.fetch();
    if (cached) ctx.budget.refund(call.credits);
    addCard(ctx, { tool: call.tool, title: call.title, cached, data: value });
    return value;
  } catch (err) {
    ctx.budget.refund(call.credits);
    return { error: failureCode(ctx, err) };
  }
}

export type Settled<I, T> = { item: I; ok: true; value: T } | { item: I; ok: false; error: unknown };

/** Runs every item at once and reports each outcome, so one failure cannot hide another's credit. */
export async function settleAll<I, T>(items: I[], run: (item: I) => Promise<T>): Promise<Settled<I, T>[]> {
  return Promise.all(
    items.map(async (item): Promise<Settled<I, T>> => {
      try {
        return { item, ok: true, value: await run(item) };
      } catch (error) {
        return { item, ok: false, error };
      }
    }),
  );
}

export const gateOptions = (ctx: ToolContext) => ({ signal: ctx.signal });
