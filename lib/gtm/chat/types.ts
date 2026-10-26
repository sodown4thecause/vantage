import { validateUIMessages, type UIMessage } from "ai";
import { z } from "zod";

import { interviewStateSchema, type InterviewState } from "@/lib/onboarding/interview";
import type { ResultCard, SeoMessageRow } from "@/lib/seo-agent/conversations";
import type { StrategyProposal } from "@/lib/gtm/proposals/types";
import { readScanHealth, type ScanHealth } from "@/lib/scan/health";
import type { GtmJob } from "./jobs";

export const MAX_GTM_MESSAGES = 200;
export const MAX_GTM_MESSAGE_BYTES = 32_768;
export const MAX_GTM_HISTORY_BYTES = 524_288;

export class GtmChatLimitError extends Error {
  constructor() { super("Conversation limit reached; start a new conversation."); this.name = "GtmChatLimitError"; }
}

export type GtmLegacyContext = Pick<SeoMessageRow, "status" | "creditsUsed" | "createdAt"> & Omit<SeoMessageRow["parts"], "cards">;
export type GtmUIMessage = UIMessage<never, {
  card: ResultCard;
  interview: InterviewState;
  legacy: GtmLegacyContext;
  proposal: StrategyProposal;
  job: GtmJob;
  turn: { state: "complete" | "interrupted" };
}, { show_card: { input: Record<string, never>; output: ResultCard } }>;

export const gtmCardSchema = z.strictObject({
  tool: z.string().min(1).max(100), title: z.string().max(500), fetchedAt: z.string().max(100).nullable(),
  cached: z.boolean(), data: z.json(), sandbox: z.boolean().optional(),
});
export const gtmDataSchemas = {
  card: gtmCardSchema,
  interview: interviewStateSchema,
  // Display-only JSON. The confirmation boundary re-reads and validates the authoritative server proposal.
  proposal: z.strictObject({ id: z.uuid(), workspaceId: z.uuid(), conversationId: z.uuid(), strategyVersion: z.number().int().nonnegative(), payload: z.custom<StrategyProposal["payload"]>(value => z.record(z.string(), z.json()).safeParse(value).success && gtmJsonBytes(value) <= 65_536), payloadHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().max(100), status: z.enum(["pending", "applied", "denied", "superseded", "expired"]) }),
  job: z.strictObject({ id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/), workspaceId: z.uuid(), state: z.enum(["queued", "running", "complete", "partial", "failed", "cancel_requested", "cancelled"]), health: z.custom<ScanHealth>(value => readScanHealth(value) !== undefined).nullable() }),
  turn: z.strictObject({ state: z.enum(["complete", "interrupted"]) }),
  legacy: z.strictObject({
    status: z.enum(["complete", "incomplete", "needs_approval", "approved"]),
    creditsUsed: z.number().finite().nonnegative(), createdAt: z.string().max(100),
    followUps: z.strictObject({ seo: z.string(), geo: z.string(), content: z.string() }).optional(),
    plan: z.array(z.strictObject({ tool: z.string().max(100), input: z.record(z.string(), z.json()), credits: z.number().finite().nonnegative() })).max(50).optional(),
    notices: z.array(z.string()).max(50).optional(),
  }),
};
// Display-only history: this tool has schemas but no executor or authority to mutate a profile.
export const gtmHistoryTools = { show_card: { inputSchema: z.strictObject({}), outputSchema: gtmCardSchema } };

const partSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string(), state: z.literal("done").optional() }),
  z.strictObject({ type: z.literal("data-card"), id: z.string().max(100).optional(), data: z.unknown() }),
  z.strictObject({ type: z.literal("data-interview"), id: z.string().max(100).optional(), data: z.unknown() }),
  z.strictObject({ type: z.literal("data-legacy"), id: z.string().max(100).optional(), data: z.unknown() }),
  z.strictObject({ type: z.literal("data-proposal"), id: z.string().max(100).optional(), data: z.unknown() }),
  z.strictObject({ type: z.literal("data-job"), id: z.string().max(100).optional(), data: z.unknown() }),
  z.strictObject({ type: z.literal("data-turn"), id: z.string().max(100).optional(), data: z.unknown() }),
  z.strictObject({ type: z.literal("tool-show_card"), toolCallId: z.string().min(1).max(100), state: z.literal("output-available"), input: z.unknown(), output: z.unknown() }),
]);
const messageSchema = z.strictObject({ id: z.string().min(1).max(100), role: z.enum(["user", "assistant"]), parts: z.array(partSchema).min(1).max(64) });

export function gtmJsonBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

/** Validate on both persistence boundaries; never trust UIMessage's compile-time type. */
export async function validateGtmMessages(messages: unknown): Promise<GtmUIMessage[]> {
  if (!Array.isArray(messages)) throw new Error("Invalid chat messages");
  if (messages.length > MAX_GTM_MESSAGES || gtmJsonBytes(messages) > MAX_GTM_HISTORY_BYTES || messages.some(m => gtmJsonBytes(m) > MAX_GTM_MESSAGE_BYTES)) throw new GtmChatLimitError();
  const parsed = z.array(messageSchema).parse(messages);
  if (new Set(parsed.map(m => m.id)).size !== parsed.length) throw new Error("Invalid chat messages");
  if (!parsed.length) return [];
  return validateUIMessages<GtmUIMessage>({ messages: parsed, dataSchemas: gtmDataSchemas, tools: gtmHistoryTools });
}
