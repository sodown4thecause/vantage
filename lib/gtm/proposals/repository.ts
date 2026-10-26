import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { ProposalAuthorizationError, ProposalBusyError, ProposalConflictError, proposalHash, proposalScopeSchema, resolveProfileChange, resolveSourceChange, strategyChangeSchema, strategyPreferencesSchema, type StrategyChange, type StrategyProposal, type StrategyState } from "./types";

export async function proposalActor(workspaceId: string): Promise<string> {
  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) throw new ProposalAuthorizationError(authorization.status);
  return authorization.userId;
}
export const sourceSnapshotSql = (workspaceId: string) => sql`(select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type, 'lane', lane, 'config', config - 'lastRun', 'enabled', health <> 'paused') order by id), '[]'::jsonb) from source where workspace_id = ${workspaceId}::uuid)`;
export const proposalColumns = sql`id, workspace_id as "workspaceId", conversation_id as "conversationId", strategy_version as "strategyVersion", payload, payload_hash as "payloadHash", expires_at::text as "expiresAt", status`;

/** Recover the latest pending confirmation even if its foreground stream stopped before the card arrived. */
export async function getPendingStrategyProposal(input: { workspaceId: string; conversationId: string }): Promise<StrategyProposal | null> {
  const { workspaceId, conversationId } = proposalScopeSchema.parse(input);
  await proposalActor(workspaceId);
  const [row] = rowsOf(await getDb().execute(sql`select ${proposalColumns} from gtm_proposal where workspace_id = ${workspaceId}::uuid and conversation_id = ${conversationId}::uuid and status = 'pending' and expires_at > now() order by expires_at desc limit 1`)) as StrategyProposal[];
  return row ?? null;
}

/** Each statement is submitted in one Neon HTTP transaction; the lock precedes fresh statement snapshots. */
export async function proposalBatch(workspaceId: string, statements: [SQL, ...SQL[]], lockDomains = false) {
  const db = getDb();
  // Legacy profile/source writers do not take our workspace lock. These short table locks also protect their counts/snapshots.
  // shortcut: serialize domain writes during approval; replace with shared per-workspace writer locks when all legacy writers migrate.
  const queries = [
    db.execute(sql`select set_config('lock_timeout', '1000ms', true), set_config('statement_timeout', '10000ms', true)`),
    ...(lockDomains ? [db.execute(sql`lock table monitoring_profile, source in share row exclusive mode`)] : []),
    db.execute(sql`select id from workspace where id = ${workspaceId}::uuid for update`),
    ...statements.map(statement => db.execute(statement)),
  ];
  try { return await db.batch(queries as [typeof queries[number], ...typeof queries[number][]]); }
  catch (error) {
    let cause: unknown = error;
    for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
      if ("code" in cause && ["55P03", "57014", "40P01", "40001"].includes(String(cause.code))) throw new ProposalBusyError();
      cause = "cause" in cause ? cause.cause : null;
    }
    throw error;
  }
}

export async function createStrategyProposal(input: { workspaceId: string; conversationId: string; strategyVersion: number; payload: StrategyChange }): Promise<StrategyProposal> {
  const parsed = proposalScopeSchema.extend({ strategyVersion: z.number().int().nonnegative(), payload: strategyChangeSchema }).parse(input);
  await proposalActor(parsed.workspaceId);
  const current = await getLatestMonitoringProfile(parsed.workspaceId);
  const profile = resolveProfileChange(parsed.payload, current);
  const sources = parsed.payload.sources?.map(change => ({ ...resolveSourceChange(change), id: change.sourceId ?? crypto.randomUUID(), existing: Boolean(change.sourceId) })) ?? [];
  const prepared = { profile, sources };
  const id = crypto.randomUUID();
  const results = await proposalBatch(parsed.workspaceId, [
    sql`insert into gtm_strategy (workspace_id) select workspace_id from seo_conversation where id = ${parsed.conversationId}::uuid and workspace_id = ${parsed.workspaceId}::uuid on conflict do nothing`,
    sql`with inserted as (
      insert into gtm_proposal (id, workspace_id, conversation_id, strategy_version, profile_version, payload, payload_hash, prepared, source_snapshot, expires_at)
      select ${id}::uuid, c.workspace_id, c.id, s.version, ${current?.version ?? 0}, ${JSON.stringify(parsed.payload)}::jsonb, ${proposalHash(parsed.payload)}, ${JSON.stringify(prepared)}::jsonb, ${sourceSnapshotSql(parsed.workspaceId)}, now() + interval '24 hours'
      from seo_conversation c join gtm_strategy s on s.workspace_id = c.workspace_id
      where c.id = ${parsed.conversationId}::uuid and c.workspace_id = ${parsed.workspaceId}::uuid and s.version = ${parsed.strategyVersion}
        and coalesce((select max(version) from monitoring_profile where workspace_id = c.workspace_id), 0) = ${current?.version ?? 0}
        and not exists (select 1 from jsonb_array_elements(${JSON.stringify(sources)}::jsonb) x where (x->>'existing')::boolean and not exists (select 1 from source where workspace_id = c.workspace_id and id = (x->>'id')::uuid))
        and not exists (select 1 from jsonb_array_elements(${JSON.stringify(parsed.payload.expertiseNotes ?? [])}::jsonb) note, jsonb_array_elements_text(note->'evidenceIds') evidence where not exists (select 1 from document where workspace_id = c.workspace_id and id = evidence::uuid))
      returning *
    ), superseded as (
      update gtm_proposal set status = 'superseded' where workspace_id = ${parsed.workspaceId}::uuid and conversation_id = ${parsed.conversationId}::uuid and status = 'pending' and exists (select 1 from inserted)
    ) select ${proposalColumns} from inserted`,
  ]);
  const row = rowsOf(results.at(-1))[0] as StrategyProposal | undefined;
  if (!row) throw new ProposalConflictError();
  return row;
}

export async function getStrategyProposal(input: { workspaceId: string; conversationId: string; proposalId: string }): Promise<StrategyProposal> {
  const parsed = proposalScopeSchema.extend({ proposalId: z.uuid() }).parse(input);
  await proposalActor(parsed.workspaceId);
  const [row] = rowsOf(await getDb().execute(sql`select ${proposalColumns} from gtm_proposal
    where id = ${parsed.proposalId}::uuid and workspace_id = ${parsed.workspaceId}::uuid and conversation_id = ${parsed.conversationId}::uuid
    and exists (select 1 from seo_conversation where id = ${parsed.conversationId}::uuid and workspace_id = ${parsed.workspaceId}::uuid)`)) as StrategyProposal[];
  if (!row) throw new ProposalConflictError();
  return { ...row, status: row.status === "pending" && Date.parse(row.expiresAt) <= Date.now() ? "expired" : row.status };
}

/** Domain tables remain authoritative; proposal patches are never treated as complete strategy snapshots. */
export async function getStrategyState(input: { workspaceId: string; conversationId: string }): Promise<StrategyState> {
  const { workspaceId, conversationId } = proposalScopeSchema.parse(input);
  await proposalActor(workspaceId);
  const [row] = rowsOf(await getDb().execute(sql`
    select coalesce(s.version, 0) as "strategyVersion", coalesce(s.data, '{}'::jsonb) - 'profile' - 'competitors' - 'keywords' - 'sources' as preferences,
      (select jsonb_build_object('id', p.id, 'workspaceId', p.workspace_id, 'version', p.version, 'productUrl', p.product_url, 'docsUrls', p.docs_urls, 'productDescription', p.product_description, 'targetCustomer', p.target_customer, 'competitors', p.competitors, 'topics', p.topics, 'productMaterialStatus', p.product_material_status, 'productMaterialText', p.product_material_text, 'retrievalNotes', p.retrieval_notes, 'createdAt', p.created_at)
        from monitoring_profile p where p.workspace_id = c.workspace_id order by p.version desc limit 1) as profile,
      (select coalesce(jsonb_agg(jsonb_build_object('sourceId', x.id, 'name', x.name, 'type', x.type, 'config', x.config - 'lastRun', 'enabled', x.health <> 'paused') order by x.id), '[]'::jsonb) from source x where x.workspace_id = c.workspace_id) as sources
    from seo_conversation c left join gtm_strategy s on s.workspace_id = c.workspace_id
    where c.id = ${conversationId}::uuid and c.workspace_id = ${workspaceId}::uuid
  `)) as (Pick<StrategyState, "strategyVersion" | "profile" | "sources"> & { preferences: unknown })[];
  if (!row) throw new ProposalConflictError();
  return { ...strategyPreferencesSchema.parse(row.preferences), strategyVersion: row.strategyVersion, profile: row.profile, sources: row.sources,
    competitors: row.profile?.competitors ?? [], keywords: row.profile?.topics ?? [] };
}
