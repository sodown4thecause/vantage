import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import { interviewStateOf } from "@/lib/onboarding/interview-store";
import { INTERVIEW_CARD_TOOL } from "@/lib/onboarding/interview";
import { ConversationNotFoundError, type SeoMessageRow } from "@/lib/seo-agent/conversations";
import { adaptLegacyTurns } from "./legacy";
import { GtmChatLimitError, gtmJsonBytes, MAX_GTM_HISTORY_BYTES, MAX_GTM_MESSAGES, validateGtmMessages, type GtmUIMessage } from "./types";

const scopeSchema = z.strictObject({ workspaceId: z.uuid(), conversationId: z.uuid() });
type Scope = z.infer<typeof scopeSchema>;
export class GtmChatRevisionConflictError extends Error {
  constructor() { super("Chat revision conflict; reload the conversation."); this.name = "GtmChatRevisionConflictError"; }
}

export async function loadGtmChat(input: Scope): Promise<{ messages: GtmUIMessage[]; revision: number }> {
  const { workspaceId, conversationId } = scopeSchema.parse(input);
  const [row] = rowsOf(await getDb().execute(sql`
    select chat.messages, chat.revision from seo_conversation owner
    left join gtm_chat chat on chat.conversation_id = owner.id and chat.workspace_id = owner.workspace_id
    where owner.id = ${conversationId}::uuid and owner.workspace_id = ${workspaceId}::uuid
  `)) as { messages: unknown; revision: number | null }[];
  if (!row) throw new ConversationNotFoundError();
  if (row.messages !== null) return { messages: await validateGtmMessages(row.messages), revision: z.number().int().min(0).max(MAX_GTM_MESSAGES).parse(row.revision) };
  const turns = rowsOf(await getDb().execute(sql`
    select id, role, content, parts, status, credits_used as "creditsUsed", created_at::text as "createdAt"
    from seo_message where conversation_id = ${conversationId}::uuid and workspace_id = ${workspaceId}::uuid
    order by created_at, id limit ${MAX_GTM_MESSAGES + 1}
  `)) as SeoMessageRow[];
  const interview = turns.some(t => t.parts.cards?.some(c => c.tool === INTERVIEW_CARD_TOOL)) ? interviewStateOf(turns) : null;
  return { messages: await validateGtmMessages(adaptLegacyTurns({ turns, interview })), revision: 0 };
}

/** Callers authorizeWorkspace first; the SQL rechecks the authoritative conversation owner. */
export async function appendGtmMessages(input: Scope & { expectedRevision: number; messages: GtmUIMessage[]; requestId: string }): Promise<{ revision: number; replayed: boolean }> {
  const { workspaceId, conversationId } = scopeSchema.parse({ workspaceId: input.workspaceId, conversationId: input.conversationId });
  const expectedRevision = z.number().int().min(0).max(MAX_GTM_MESSAGES).parse(input.expectedRevision);
  const requestId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).refine(v => !["constructor", "prototype", "__proto__"].includes(v)).parse(input.requestId);
  const validated = await validateGtmMessages(input.messages);
  if (!validated.length) throw new Error("An append must contain messages");
  const current = await loadGtmChat({ workspaceId, conversationId });
  const hash = createHash("sha256").update(JSON.stringify({ expectedRevision, messages: validated.map(({ role, parts }) => ({ role, parts })) })).digest("hex");
  const messages = validated.map(m => ({ ...m, id: crypto.randomUUID() }));
  await validateGtmMessages(messages);
  const token = crypto.randomUUID();
  const receipt = JSON.stringify({ hash, revision: expectedRevision + 1, token });
  const seed = JSON.stringify([...current.messages, ...messages]);
  const addition = JSON.stringify(messages);
  // shortcut: bounded JSON history; move to paginated message rows when conversations need more than 200 messages.
  const [result] = rowsOf(await getDb().execute(sql`
    with appended as (
    insert into gtm_chat (conversation_id, workspace_id, messages, revision, receipts)
    select owner.id, owner.workspace_id,
      case when exists (select 1 from gtm_chat where conversation_id = owner.id and workspace_id = owner.workspace_id)
        then '[]'::jsonb else ${seed}::jsonb end,
      1, jsonb_build_object(${requestId}::text, ${receipt}::jsonb)
    from seo_conversation owner
    where owner.id = ${conversationId}::uuid and owner.workspace_id = ${workspaceId}::uuid
      and (${expectedRevision}::integer = 0 or exists (select 1 from gtm_chat where conversation_id = owner.id and workspace_id = owner.workspace_id))
      and (exists (select 1 from gtm_chat where conversation_id = owner.id and workspace_id = owner.workspace_id)
        or (jsonb_array_length(${seed}::jsonb) <= ${MAX_GTM_MESSAGES} and octet_length((${seed}::jsonb)::text) <= ${MAX_GTM_HISTORY_BYTES}))
    on conflict (conversation_id) do update set
      messages = case when gtm_chat.receipts ? ${requestId} then gtm_chat.messages else gtm_chat.messages || ${addition}::jsonb end,
      revision = case when gtm_chat.receipts ? ${requestId} then gtm_chat.revision else gtm_chat.revision + 1 end,
      receipts = case when gtm_chat.receipts ? ${requestId} then gtm_chat.receipts
        else gtm_chat.receipts || jsonb_build_object(${requestId}::text, ${receipt}::jsonb) end
    where gtm_chat.workspace_id = ${workspaceId}::uuid and (
      (gtm_chat.receipts -> ${requestId} ->> 'hash' = ${hash}) or
      (not (gtm_chat.receipts ? ${requestId}) and gtm_chat.revision = ${expectedRevision}::integer
        and jsonb_array_length(gtm_chat.messages || ${addition}::jsonb) <= ${MAX_GTM_MESSAGES}
        and octet_length((gtm_chat.messages || ${addition}::jsonb)::text) <= ${MAX_GTM_HISTORY_BYTES})
    )
    returning (receipts -> ${requestId} ->> 'revision')::integer as revision,
      (receipts -> ${requestId} ->> 'token') <> ${token} as replayed
    ), touched as (
      update seo_conversation set updated_at = now() from appended
      where seo_conversation.id = ${conversationId}::uuid and seo_conversation.workspace_id = ${workspaceId}::uuid
        and not appended.replayed
    ) select revision, replayed, false as limited from appended
    union all
    select null as revision, false as replayed, true as limited from seo_conversation owner
    left join gtm_chat chat on chat.conversation_id = owner.id and chat.workspace_id = owner.workspace_id
    where owner.id = ${conversationId}::uuid and owner.workspace_id = ${workspaceId}::uuid
      and not exists (select 1 from appended)
      and coalesce(chat.revision, 0) = ${expectedRevision}::integer
      and not (coalesce(chat.receipts, '{}'::jsonb) ? ${requestId})
      and (jsonb_array_length(coalesce(chat.messages, ${JSON.stringify(current.messages)}::jsonb) || ${addition}::jsonb) > ${MAX_GTM_MESSAGES}
        or octet_length((coalesce(chat.messages, ${JSON.stringify(current.messages)}::jsonb) || ${addition}::jsonb)::text) > ${MAX_GTM_HISTORY_BYTES})
  `)) as { revision: number; replayed: boolean; limited?: boolean }[];
  if (result?.limited) throw new GtmChatLimitError();
  if (result) return { revision: result.revision, replayed: result.replayed };
  if (current.revision === expectedRevision && (current.messages.length + messages.length > MAX_GTM_MESSAGES || gtmJsonBytes([...current.messages, ...messages]) > MAX_GTM_HISTORY_BYTES)) throw new GtmChatLimitError();
  throw new GtmChatRevisionConflictError();
}
