import { createHash } from "node:crypto";
import { z } from "zod";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import { isValidTimeZone } from "@/lib/digest/schedule";
import { validateMonitoringProfileInput } from "@/lib/profile/validate";
import type { MonitoringProfileInput } from "@/lib/profile/types";
import { buildSearchSource } from "@/lib/sources/search";
import { gtmJsonBytes } from "@/lib/gtm/chat/types";

const text = z.string().trim().min(1).max(8_000);
const words = z.array(z.string().trim().min(1).max(200));
const profileSchema = z.strictObject({
  productUrl: z.string().max(2_000).optional(), docsUrls: z.array(z.string().max(2_000)).max(8).optional(),
  productDescription: text.optional(), targetCustomer: text.optional(),
  competitors: words.min(3).max(5).optional(), topics: words.min(1).max(12).optional(),
  productMaterialManual: z.string().max(50_000).optional(), forceManualMaterial: z.boolean().optional(),
}).refine(value => Object.keys(value).length > 0);
const sourceChangeSchema = z.strictObject({
  sourceId: z.uuid().optional(), type: z.enum(["hn", "reddit", "stackoverflow", "github", "forums", "blogs", "rss"]),
  config: z.record(z.string(), z.unknown()), enabled: z.boolean(),
}).superRefine((value, ctx) => { try { resolveSourceChange(value); } catch { ctx.addIssue({ code: "custom", message: "Invalid source configuration" }); } });
export const strategyChangeSchema = z.strictObject({
  profile: profileSchema.optional(), competitors: words.min(3).max(5).optional(), keywords: words.min(1).max(12).optional(),
  sources: z.array(sourceChangeSchema).min(1).max(25).optional(),
  // shortcut: daily/weekly schedules only; extend validation with the scheduler when finer cadence is supported.
  schedule: z.strictObject({ kind: z.enum(["scan", "weekly_recommendations"]), cron: z.string().regex(/^(?:[0-5]?\d) (?:[01]?\d|2[0-3]) \* \* (?:\*|[0-6])$/), timeZone: z.string().max(64).refine(isValidTimeZone) }).optional(),
  exclusions: words.max(100).optional(), expertiseNotes: z.array(z.strictObject({ text, evidenceIds: z.array(z.uuid()).max(50) })).max(50).optional(),
}).refine(value => Object.keys(value).length > 0 && gtmJsonBytes(value) <= 65_536, "Empty or oversized change")
  .refine(value => !(value.competitors && value.profile?.competitors) && !(value.keywords && value.profile?.topics), "Specify each profile field once")
  .refine(value => { const ids = value.sources?.flatMap(s => s.sourceId ? [s.sourceId] : []) ?? []; return new Set(ids).size === ids.length; }, "Duplicate source ID");
export type StrategyChange = z.infer<typeof strategyChangeSchema>;
export type StrategyProposal = { id: string; workspaceId: string; conversationId: string; strategyVersion: number; payload: StrategyChange; payloadHash: string; expiresAt: string; status: "pending" | "applied" | "denied" | "superseded" | "expired" };
export const proposalScopeSchema = z.strictObject({ workspaceId: z.uuid(), conversationId: z.uuid() });
export const applyProposalSchema = proposalScopeSchema.extend({ proposalId: z.uuid(), strategyVersion: z.number().int().nonnegative(), requestId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/) });
export const proposalDecisionSchema = proposalScopeSchema.extend({ strategyVersion: z.number().int().nonnegative(), requestId: applyProposalSchema.shape.requestId, payloadHash: z.string().regex(/^[a-f0-9]{64}$/), state: z.literal("approval-responded"), approval: z.strictObject({ id: z.uuid(), approved: z.boolean() }) });
export class ProposalConflictError extends Error { constructor() { super("Proposal unavailable, unconfirmed, expired or stale; review a new proposal."); this.name = "ProposalConflictError"; } }
export class ProposalBusyError extends Error { constructor() { super("Proposal busy; retry the same confirmation request."); this.name = "ProposalBusyError"; } }
export class ProposalAuthorizationError extends Error { constructor(readonly status: number) { super("Unable to access this proposal."); } }

export function proposalHash(payload: StrategyChange): string {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value;
  return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}
export function resolveProfileChange(change: StrategyChange, current: Partial<MonitoringProfileInput> | null): MonitoringProfileInput | null {
  if (!change.profile && !change.competitors && !change.keywords) return null;
  const parsed = strategyChangeSchema.parse(change);
  const result = validateMonitoringProfileInput({ ...current, ...parsed.profile, ...(parsed.competitors ? { competitors: parsed.competitors } : {}), ...(parsed.keywords ? { topics: parsed.keywords } : {}) });
  if (!result.ok) throw new Error("Invalid monitoring profile");
  return result.value;
}
export function resolveSourceChange(value: { sourceId?: string; type: string; config: Record<string, unknown>; enabled: boolean }) {
  if (value.type === "rss") {
    const { feedUrl } = z.strictObject({ feedUrl: z.string().max(2_000).refine(isPublicHttpUrl) }).parse(value.config);
    return { name: `RSS: ${new URL(feedUrl).hostname} (${createHash("sha256").update(feedUrl).digest("hex").slice(0, 10)})`, type: "rss", lane: "free", config: { feedUrl }, health: value.enabled ? "healthy" : "paused" };
  }
  const config = z.strictObject({ query: z.string().max(100), subreddit: z.string().max(30).optional(), tag: z.string().max(35).optional() }).parse(value.config);
  if ((config.subreddit && value.type !== "reddit") || (config.tag && value.type !== "stackoverflow")) throw new Error("Unsupported source filter");
  const result = buildSearchSource({ platform: value.type, ...config });
  if (!result.ok) throw new Error(result.error);
  return { ...result.source, health: value.enabled ? "healthy" : "paused" };
}
