import { sql } from "drizzle-orm";
import { rowsOf } from "@/lib/db/rows";
import { countLimitSql } from "@/lib/plans/limits";
import { reservedProfileSourceSlot } from "@/lib/sources/persist";
import { proposalActor, proposalBatch, sourceSnapshotSql } from "./repository";
import { applyProposalSchema, ProposalConflictError } from "./types";

/** No approval capability here: only the dedicated user-decision route can create a confirmation record. */
export async function applyStrategyProposal(input: { workspaceId: string; conversationId: string; proposalId: string; strategyVersion: number; requestId: string }): Promise<{ proposalId: string; strategyVersion: number; replayed: boolean }> {
  const value = applyProposalSchema.parse(input);
  const { workspaceId, conversationId, proposalId, strategyVersion, requestId } = value;
  const actor = await proposalActor(workspaceId);
  const results = await proposalBatch(workspaceId, [sql`
    with eligible as materialized (
      select p.*, d.actor_id, d.created_at as confirmed_at from gtm_proposal p
      join gtm_proposal_decision d on d.proposal_id = p.id and d.workspace_id = p.workspace_id and d.conversation_id = p.conversation_id and d.strategy_version = p.strategy_version and d.payload_hash = p.payload_hash
      join seo_conversation c on c.id = p.conversation_id and c.workspace_id = p.workspace_id
      join gtm_strategy s on s.workspace_id = p.workspace_id and s.version = p.strategy_version
      where p.id = ${proposalId}::uuid and p.workspace_id = ${workspaceId}::uuid and p.conversation_id = ${conversationId}::uuid
        and p.strategy_version = ${strategyVersion} and p.status = 'pending' and p.expires_at > now()
        and d.request_id = ${requestId} and d.approved and d.actor_id = ${actor}
        and p.profile_version = coalesce((select max(version) from monitoring_profile where workspace_id = p.workspace_id), 0)
        and p.source_snapshot = ${sourceSnapshotSql(workspaceId)}
        and (p.prepared->'profile' = 'null'::jsonb or jsonb_array_length(p.prepared->'profile'->'topics') <= greatest(${countLimitSql(workspaceId, "keywords")}, coalesce((select jsonb_array_length(topics) from monitoring_profile where workspace_id = p.workspace_id order by version desc limit 1), 0)))
        and ((select count(*) from jsonb_array_elements(p.prepared->'sources') x where not (x->>'existing')::boolean) = 0 or
          (select count(*) from source where workspace_id = p.workspace_id) + (select count(*) from jsonb_array_elements(p.prepared->'sources') x where not (x->>'existing')::boolean) + ${reservedProfileSourceSlot(workspaceId)} <= ${countLimitSql(workspaceId, "sources")})
    ), advanced as (
      update gtm_strategy s set version = s.version + 1,
        data = (s.data - 'profile' - 'competitors' - 'keywords' - 'sources') || (p.payload - 'profile' - 'competitors' - 'keywords' - 'sources')
      from eligible p where s.workspace_id = p.workspace_id and s.version = p.strategy_version returning s.version
    ), profile_written as (
      insert into monitoring_profile (workspace_id, version, product_url, docs_urls, product_description, target_customer, competitors, topics, product_material_status, product_material_text, retrieval_notes)
      select p.workspace_id, p.profile_version + 1, p.prepared->'profile'->>'productUrl', p.prepared->'profile'->'docsUrls', p.prepared->'profile'->>'productDescription', p.prepared->'profile'->>'targetCustomer', p.prepared->'profile'->'competitors', p.prepared->'profile'->'topics',
        (p.prepared->'profile'->>'materialStatus')::product_material_status, p.prepared->'profile'->>'materialText', 'Approved strategy change; no upstream retrieval performed.'
      from eligible p, advanced where p.prepared->'profile' <> 'null'::jsonb returning id
    ), sources_added as (
      insert into source (id, workspace_id, name, type, lane, config, health)
      select (x->>'id')::uuid, p.workspace_id, x->>'name', (x->>'type')::source_type, (x->>'lane')::source_lane, x->'config', (x->>'health')::source_health
      from eligible p, advanced, jsonb_array_elements(p.prepared->'sources') x where not (x->>'existing')::boolean returning id
    ), sources_updated as (
      update source s set name = x->>'name', type = (x->>'type')::source_type, lane = (x->>'lane')::source_lane,
        config = x->'config', health = (x->>'health')::source_health, cursor = null, etag = null, last_modified = null, updated_at = now()
      from eligible p, advanced, jsonb_array_elements(p.prepared->'sources') x
      where (x->>'existing')::boolean and s.id = (x->>'id')::uuid and s.workspace_id = p.workspace_id returning s.id
    ), applied as (
      update gtm_proposal p set status = 'applied' from eligible e, advanced where p.id = e.id and p.workspace_id = e.workspace_id and p.conversation_id = e.conversation_id returning p.id
    ), receipt as (
      insert into gtm_proposal_receipt (proposal_id, workspace_id, conversation_id, request_id, actor_id, strategy_version, expertise_notes, mutations_complete, confirmed_at)
      select p.id, p.workspace_id, p.conversation_id, ${requestId}, p.actor_id, advanced.version, coalesce(p.payload->'expertiseNotes', '[]'::jsonb),
        (select count(*) from applied) = 1
          and (select count(*) from profile_written) = case when p.prepared->'profile' = 'null'::jsonb then 0 else 1 end
          and (select count(*) from sources_added) + (select count(*) from sources_updated) = jsonb_array_length(p.prepared->'sources'), p.confirmed_at
      from eligible p, advanced returning proposal_id, workspace_id, strategy_version
    ), outbox as (
      insert into gtm_strategy_outbox (proposal_id, workspace_id, strategy_version)
      select proposal_id, workspace_id, strategy_version from receipt returning proposal_id
    ) select receipt.proposal_id as "proposalId", receipt.strategy_version as "strategyVersion", false as replayed from receipt join outbox using (proposal_id)
    union all select r.proposal_id as "proposalId", r.strategy_version as "strategyVersion", true as replayed
      from gtm_proposal_receipt r join gtm_proposal p on p.id = r.proposal_id and p.workspace_id = r.workspace_id and p.conversation_id = r.conversation_id
      where r.workspace_id = ${workspaceId}::uuid and r.conversation_id = ${conversationId}::uuid and r.proposal_id = ${proposalId}::uuid
        and r.request_id = ${requestId} and r.actor_id = ${actor} and p.strategy_version = ${strategyVersion}
        and not exists (select 1 from receipt)
  `], true);
  const row = rowsOf(results.at(-1))[0] as { proposalId: string; strategyVersion: number; replayed: boolean } | undefined;
  if (!row) throw new ProposalConflictError();
  return row;
}
