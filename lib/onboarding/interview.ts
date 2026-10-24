import { z } from "zod";

import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import { PROFILE_FIELDS, profileDraftSchema, type ProfileDraft, type ProfileField } from "@/lib/onboarding/draft";
import type { FieldErrors, MonitoringProfileInput, MonitoringProfileView } from "@/lib/profile/types";

/*
 * The in-workspace onboarding interview: one question per turn, deterministic (no model call, no question
 * allowance spent). Pure functions only; the route persists state and saves through the profile repository.
 */

export const INTERVIEW_STEPS = ["productUrl", "productDescription", "targetCustomer", "competitors", "communities", "keywords", "digest"] as const;
export type InterviewStep = (typeof INTERVIEW_STEPS)[number];

export const INTERVIEW_CARD_TOOL = "onboarding_interview";
export const INTERVIEW_TITLE = "Product setup interview";

const MAX_TEXT = 8_000;
const MIN_COMPETITORS = 3;
const MAX_COMPETITORS = 5;
const MAX_COMMUNITIES = 10;
const MAX_KEYWORDS = 12;
const COMMUNITIES_LABEL = "Communities they use:";

// The digest is scheduled from the local hour in an IANA time zone. `hourUtc` is today's equivalent, also written to
// the legacy UTC column so anything still reading it stays close.
const digestSchema = z.object({
  localHour: z.number().int().min(0).max(23),
  timeZone: z.string().max(64),
  hourUtc: z.number().int().min(0).max(23),
});

/** Stored in the interview conversation. `null` means the owner skipped an optional step. */
export const interviewAnswersSchema = z.object({
  productUrl: z.string().max(2000).optional(),
  productDescription: z.string().max(MAX_TEXT).optional(),
  targetCustomer: z.string().max(MAX_TEXT).optional(),
  competitors: z.array(z.string().max(200)).max(MAX_COMPETITORS).optional(),
  communities: z.array(z.string().max(100)).max(MAX_COMMUNITIES).optional(),
  keywords: z.array(z.string().max(100)).max(MAX_KEYWORDS).optional(),
  digest: digestSchema.nullable().optional(),
});
export type InterviewAnswers = z.infer<typeof interviewAnswersSchema>;

/**
 * `answers` holds confirmed values only; `draft` holds what was derived from the website and not yet confirmed. So the
 * first unanswered step is also the first unconfirmed field, and a returning owner resumes there.
 */
export const interviewStateSchema = z.object({ answers: interviewAnswersSchema, draft: profileDraftSchema.optional(), complete: z.boolean() });
export type InterviewState = z.infer<typeof interviewStateSchema>;

/**
 * A quick answer sends `value` as the owner's answer. A question shows `reply` straight away and does not advance
 * the interview.
 */
export type InterviewSuggestion =
  | { kind: "answer"; label: string; reason: string; value: string }
  | { kind: "ask"; label: string; reason: string; reply: string };

export type InterviewPrompt = { step: InterviewStep; position: number; total: number; question: string; suggestions: InterviewSuggestion[] };

/** What the interview route returns for each turn. */
export type InterviewResponse = {
  conversationId: string;
  complete: boolean;
  /** The assistant's reply: the next question, a correction, or the closing summary. */
  message: string;
  /** The question now being asked; absent once complete or while a failed save waits for a retry. */
  prompt?: InterviewPrompt;
  /** True when the answer was not accepted and nothing was stored. */
  rejected?: boolean;
  /** Once complete: the product's host name for the workspace header. */
  productName?: string;
  profileSaved?: boolean;
  /** The profile derived from the website, for the editable card. Confirmed fields are in `answers`. */
  draft?: ProfileDraft;
  answers?: InterviewAnswers;
};

/** True while the owner is reviewing the derived profile card rather than answering one question. */
export function reviewingDraft(answers: InterviewAnswers, draft: ProfileDraft | undefined): boolean {
  const step = nextStep(answers);
  return Boolean(draft) && step !== null && (PROFILE_FIELDS as readonly string[]).includes(step);
}

export function draftReviewMessage(answers: InterviewAnswers): string {
  return `I read ${hostOf(answers.productUrl)} and drafted your profile below. Edit anything that’s off, then choose “Looks right”.`;
}

export type ConfirmResult = { ok: true; answers: InterviewAnswers } | { ok: false; field: ProfileField; error: string };

/**
 * Confirms edited or accepted card fields, each through the same validation as a typed answer. Already confirmed
 * fields are left alone, and nothing is stored unless every submitted field is valid.
 */
export function confirmFields(answers: InterviewAnswers, values: Partial<Record<ProfileField, string>>): ConfirmResult {
  let next = answers;
  for (const field of PROFILE_FIELDS) {
    const value = values[field];
    if (value === undefined || next[field] !== undefined) continue;
    // An empty communities field means "none", which the communities step reads from "skip".
    const applied = applyAnswer(next, field, field === "communities" && !value.trim() ? "skip" : value);
    if (!applied.ok) return { ok: false, field, error: applied.error };
    next = applied.answers;
  }
  return { ok: true, answers: next };
}

/** The first step without an answer, or null when every step is answered. Resuming starts here. */
export function nextStep(answers: InterviewAnswers): InterviewStep | null {
  return INTERVIEW_STEPS.find((step) => answers[step] === undefined) ?? null;
}

export function stepNumber(step: InterviewStep): number {
  return INTERVIEW_STEPS.indexOf(step) + 1;
}

export function hostOf(url: string | undefined): string {
  if (!url) return "your product";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "your product";
  }
}

/** Splits the communities sentence the interview appends to the target customer. */
export function splitCommunities(targetCustomer: string): { customer: string; communities: string[] } {
  const index = targetCustomer.lastIndexOf(`\n\n${COMMUNITIES_LABEL}`);
  if (index === -1) return { customer: targetCustomer, communities: [] };
  return {
    customer: targetCustomer.slice(0, index).trim(),
    communities: parseList(targetCustomer.slice(index + COMMUNITIES_LABEL.length + 2).replace(/\.$/, "")),
  };
}

function withCommunities(customer: string, communities: string[]): string {
  const base = splitCommunities(customer).customer;
  return communities.length ? `${base}\n\n${COMMUNITIES_LABEL} ${communities.join(", ")}.` : base;
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function keep(label: string, value: string): InterviewSuggestion {
  return { kind: "answer", label: `Keep: ${clip(value, 60)}`, reason: `Your current ${label}.`, value };
}

/** The question for a step and its three suggested prompts. `current` offers "keep" answers when updating a profile. */
export function promptFor(step: InterviewStep, answers: InterviewAnswers, current?: MonitoringProfileView | null, timeZone?: string): InterviewPrompt {
  return { ...promptBody(step, answers, current, timeZone), position: stepNumber(step), total: INTERVIEW_STEPS.length };
}

function promptBody(step: InterviewStep, answers: InterviewAnswers, current?: MonitoringProfileView | null, timeZone?: string): Omit<InterviewPrompt, "position" | "total"> {
  const host = hostOf(answers.productUrl);
  const existing = current ? splitCommunities(current.targetCustomer) : null;
  const withKeep = (keepAnswer: InterviewSuggestion | null, rest: InterviewSuggestion[]) =>
    (keepAnswer ? [keepAnswer, ...rest] : rest).slice(0, 3);
  switch (step) {
    case "productUrl":
      return { step, question: "Let’s set up your product so I can find the right conversations. Paste your product’s website address and I’ll draft the rest of your profile for you to check.", suggestions: withKeep(current ? keep("website", current.productUrl) : null, [
        { kind: "ask", label: "Why do you need my website?", reason: "How your answers are used.", reply: "I read your public site to understand what you sell, so I can judge which conversations are a genuine fit. Nothing is ever posted on your behalf." },
        { kind: "ask", label: "What if my site isn’t live yet?", reason: "You can still finish setup.", reply: "Enter the address you’ll launch on. If I can’t read it, I’ll rely on the description you give me next." },
        { kind: "ask", label: "Can I change these answers later?", reason: "Nothing here is final.", reply: "Yes. Choose “Update product profile” in the sidebar at any time. Each save keeps a new version." },
      ]) };
    case "productDescription":
      return { step, question: `In a sentence or two, what does ${host} do, and what problem does it solve?`, suggestions: withKeep(current ? keep("description", current.productDescription) : null, [
        { kind: "ask", label: "What makes a good description?", reason: "Get better matches.", reply: "Name the problem, who has it and how you solve it. For example: “Invoicing for tradies that chases late payments automatically.”" },
        { kind: "ask", label: "How long should it be?", reason: "Keep it short.", reply: "One to three sentences is plenty. Plain words work better than marketing copy, because I match them against real conversations." },
        { kind: "ask", label: "Will you read my website too?", reason: "Where else I look.", reply: "Yes, I’ll read your public site when I save the profile. Your description tells me what matters most." },
      ]) };
    case "targetCustomer":
      return { step, question: "Who’s your ideal customer? Describe the people most likely to buy.", suggestions: withKeep(existing ? keep("ideal customer", existing.customer) : null, [
        { kind: "answer", label: "Founders of early-stage B2B software companies", reason: "A common starting point for SaaS.", value: "Founders of early-stage B2B software companies" },
        { kind: "answer", label: "Marketing leads at small and medium businesses", reason: "Teams that buy growth tools.", value: "Marketing leads at small and medium businesses" },
        { kind: "answer", label: "Developers and technical teams", reason: "Builders who buy developer tools.", value: "Developers and technical teams" },
      ]) };
    case "competitors":
      return { step, question: "Name three to five competitors or alternatives people use instead. Separate them with commas.", suggestions: withKeep(current ? keep("competitors", current.competitors.join(", ")) : null, [
        { kind: "ask", label: "I’m not sure who my competitors are", reason: "Alternatives count too.", reply: "Think about what people do today instead: another tool, a spreadsheet, an agency or hiring someone. Those all count, for example “Spreadsheets, Agencies, HubSpot”." },
        { kind: "ask", label: "Why three to five?", reason: "How I use them.", reply: "That’s enough to spot comparison and switching conversations without burying you in noise." },
        { kind: "ask", label: "Can I include indirect alternatives?", reason: "Broader matches.", reply: "Yes. Indirect alternatives often show the strongest buying intent, because people are actively looking to change." },
      ]) };
    case "communities":
      return { step, question: "Which communities do your customers spend time in? Subreddits, forums or groups all help. Separate them with commas, or skip this one.", suggestions: withKeep(existing?.communities.length ? keep("communities", existing.communities.join(", ")) : null, [
        { kind: "answer", label: "Skip for now", reason: "I’ll start with Reddit and Hacker News.", value: "skip" },
        { kind: "answer", label: "r/SaaS, r/startups, Indie Hackers", reason: "Where software founders talk shop.", value: "r/SaaS, r/startups, Indie Hackers" },
        { kind: "ask", label: "Why does this matter?", reason: "How communities are used.", reply: "Communities help me choose which forums and boards to search, so the conversations I bring back are where your buyers actually are." },
      ]) };
    case "keywords": {
      const competitors = answers.competitors ?? [];
      const alternatives = competitors.slice(0, 2).map((name) => `${name} alternative`).join(", ");
      return { step, question: "What keywords or problems should I watch for? Use the words people say when they need you. Separate them with commas.", suggestions: withKeep(current ? keep("keywords", current.topics.join(", ")) : null, [
        ...(alternatives ? [{ kind: "answer" as const, label: alternatives, reason: "People looking to switch.", value: alternatives }] : []),
        { kind: "ask", label: "What makes a good keyword?", reason: "Find buyers, not browsers.", reply: "Problems in your customer’s words work best, such as “chasing late invoices” or “too many spreadsheets”, plus “<competitor> alternative”." },
        { kind: "ask", label: "How many should I add?", reason: "Plan limits apply.", reply: "Start with three to six. You can add more later, up to your plan’s keyword limit." },
        { kind: "ask", label: "Can I use my competitors’ names?", reason: "Catch switching intent.", reply: "Yes. “<competitor> alternative” and “<competitor> pricing” are some of the strongest buying signals." },
      ]) };
    }
    case "digest":
      return { step, question: `Last one: what time should your daily digest of new conversations arrive? ${timeZone ? `I’ll use your time zone (${timeZone}).` : "I’ll use this device’s time zone."}`, suggestions: [
        { kind: "answer", label: "8am", reason: "Start the day with fresh conversations.", value: "8am" },
        { kind: "answer", label: "12pm", reason: "A lunchtime check-in.", value: "12pm" },
        { kind: "answer", label: "Skip, I’ll set this later", reason: "Keep the default time.", value: "skip" },
      ] };
  }
}

export function parseList(raw: string): string[] {
  const out: string[] = [];
  for (const item of raw.split(/[,\n;]/)) {
    const trimmed = item.trim().replace(/\s+/g, " ");
    if (trimmed && !out.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed);
  }
  return out;
}

const SKIP = /^(skip|no|none|not sure|later|not now|n\/a)\b/i;
// For lists the first item must be only a skip phrase, so "No Code Founders, r/nocode" is a list, not a skip.
const SKIP_ITEM = /^(skip( for now)?|no|none|not sure( yet)?|later|not now|n\/a)[.!]?$/i;

/** Parses "8am", "8:30 pm", "17", "17:00", "noon" or "midnight" into an hour from 0 to 23. */
export function parseHour(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (/\b(noon|midday)\b/.test(text)) return 12;
  if (/\bmidnight\b/.test(text)) return 0;
  const match = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d])/);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[3]?.[0];
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "p" && hour < 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
  }
  return hour >= 0 && hour <= 23 ? hour : null;
}

/** An IANA time zone the runtime understands, or UTC. */
export function normaliseTimeZone(timeZone: string | undefined): string {
  if (!timeZone || timeZone.length > 64) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** The UTC hour for a local hour in a time zone today. Half-hour zones round down to the whole UTC hour. */
export function localHourToUtc(localHour: number, timeZone: string, now = new Date()): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMinutes = Math.round((wall - Math.floor(now.getTime() / 1000) * 1000) / 60_000);
  const utcMinutes = (((localHour * 60 - offsetMinutes) % 1440) + 1440) % 1440;
  return Math.floor(utcMinutes / 60);
}

export type ApplyResult = { ok: true; answers: InterviewAnswers } | { ok: false; error: string };

/** Validates one answer for one step and returns the updated answers. Never mutates its input. */
export function applyAnswer(answers: InterviewAnswers, step: InterviewStep, raw: string, opts: { timeZone?: string; now?: Date } = {}): ApplyResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: "I didn’t catch an answer. Could you try again?" };
  switch (step) {
    case "productUrl": {
      const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      if (/\s/.test(text) || !isPublicHttpUrl(url)) return { ok: false, error: "That doesn’t look like a public website address. Try something like example.com." };
      return { ok: true, answers: { ...answers, productUrl: new URL(url).href } };
    }
    case "productDescription":
      if (text.length < 10) return { ok: false, error: "Could you tell me a little more? A sentence about the problem you solve is enough." };
      if (text.length > MAX_TEXT) return { ok: false, error: `Please keep the description under ${MAX_TEXT.toLocaleString("en-AU")} characters.` };
      return { ok: true, answers: { ...answers, productDescription: text } };
    case "targetCustomer":
      if (text.length < 3) return { ok: false, error: "Could you describe your ideal customer in a few words?" };
      if (text.length > MAX_TEXT) return { ok: false, error: `Please keep this under ${MAX_TEXT.toLocaleString("en-AU")} characters.` };
      return { ok: true, answers: { ...answers, targetCustomer: splitCommunities(text).customer } };
    case "competitors": {
      const list = parseList(text);
      if (list.length < MIN_COMPETITORS) return { ok: false, error: `I need at least ${MIN_COMPETITORS} competitors or alternatives, separated by commas. You gave me ${list.length}.` };
      if (list.length > MAX_COMPETITORS) return { ok: false, error: `Please pick your top ${MAX_COMPETITORS}. You gave me ${list.length}.` };
      if (list.some((item) => item.length > 200)) return { ok: false, error: "Each competitor should be a name, not a description." };
      return { ok: true, answers: { ...answers, competitors: list } };
    }
    case "communities": {
      const list = parseList(text);
      if (!list.length || SKIP_ITEM.test(list[0]!)) return { ok: true, answers: { ...answers, communities: [] } };
      if (list.length > MAX_COMMUNITIES) return { ok: false, error: `Please pick up to ${MAX_COMMUNITIES} communities.` };
      if (list.some((item) => item.length > 100)) return { ok: false, error: "Each community should be a short name, such as r/SaaS." };
      return { ok: true, answers: { ...answers, communities: list } };
    }
    case "keywords": {
      const list = parseList(text);
      if (!list.length) return { ok: false, error: "Add at least one keyword or problem to watch for." };
      if (list.length > MAX_KEYWORDS) return { ok: false, error: `Please keep it to ${MAX_KEYWORDS} keywords or fewer.` };
      if (list.some((item) => item.length > 100)) return { ok: false, error: "Each keyword should be a short phrase." };
      return { ok: true, answers: { ...answers, keywords: list } };
    }
    case "digest": {
      if (SKIP.test(text)) return { ok: true, answers: { ...answers, digest: null } };
      const localHour = parseHour(text);
      if (localHour === null) return { ok: false, error: "What time works? Try something like 8am or 17:00." };
      const timeZone = normaliseTimeZone(opts.timeZone);
      return { ok: true, answers: { ...answers, digest: { localHour, timeZone, hourUtc: localHourToUtc(localHour, timeZone, opts.now) } } };
    }
  }
}

/**
 * Builds the onboarding form's payload from the answers. Docs links and manual product material from the current
 * profile carry over, because the interview does not ask for them.
 */
export function toProfileInput(answers: InterviewAnswers, current?: MonitoringProfileView | null): MonitoringProfileInput {
  // Manual material carries over only for the same site; a new website address is read afresh.
  const manual = current?.productMaterialStatus === "manual" && current.productUrl === answers.productUrl;
  return {
    productUrl: answers.productUrl ?? "",
    docsUrls: current?.docsUrls ?? [],
    productDescription: answers.productDescription ?? "",
    targetCustomer: withCommunities(answers.targetCustomer ?? "", answers.communities ?? []),
    competitors: answers.competitors ?? [],
    topics: answers.keywords ?? [],
    productMaterialManual: manual ? current!.productMaterialText : undefined,
    forceManualMaterial: manual,
  };
}

const FIELD_STEPS: [keyof FieldErrors, InterviewStep][] = [
  ["productUrl", "productUrl"], ["productDescription", "productDescription"], ["targetCustomer", "targetCustomer"],
  ["competitors", "competitors"], ["topics", "keywords"],
];

/** The step to ask again for the first profile validation error, with that answer cleared. */
export function stepForFieldErrors(answers: InterviewAnswers, errors: FieldErrors): { step: InterviewStep; error: string; answers: InterviewAnswers } | null {
  for (const [field, step] of FIELD_STEPS) {
    const error = errors[field];
    if (error) {
      const next = { ...answers };
      delete next[step];
      return { step, error, answers: next };
    }
  }
  return null;
}

/** A plain summary of the saved setup for the closing message. */
export function completionMessage(answers: InterviewAnswers, digestSaved = true): string {
  const digest = !digestSaved
    ? "Your product profile is saved, but I couldn’t save your chosen digest time. Send any message to retry. Please set it under Daily digest if you’d rather change the time."
    : answers.digest
    ? `Your daily digest is set for ${formatHour(answers.digest.localHour)} ${answers.digest.timeZone}, and it follows daylight saving. Turn on email delivery under Daily digest when you’re ready.`
    : "Your daily digest keeps its default time. You can change it under Daily digest.";
  return [
    `${digestSaved ? "You’re all set. " : ""}I’ve saved the product profile for ${hostOf(answers.productUrl)}.`,
    digest,
    "You write every reply; nothing is posted on your behalf.",
  ].join("\n\n");
}

export function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}
