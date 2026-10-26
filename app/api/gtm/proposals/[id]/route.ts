import { sql } from "drizzle-orm";
import { z } from "zod";
import { rowsOf } from "@/lib/db/rows";
import { applyStrategyProposal } from "@/lib/gtm/proposals/apply";
import { getStrategyProposal, getStrategyState, proposalActor, proposalBatch } from "@/lib/gtm/proposals/repository";
import { ProposalAuthorizationError, ProposalBusyError, ProposalConflictError, proposalDecisionSchema } from "@/lib/gtm/proposals/types";

type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  const status = error instanceof ProposalAuthorizationError ? error.status : error instanceof ProposalBusyError ? 503 : error instanceof z.ZodError ? 400 : error instanceof ProposalConflictError ? 409 : 500;
  return Response.json({ error: status === 503 ? "Proposal busy; retry the same confirmation request." : status === 500 ? "Proposal request failed" : "Unable to confirm this proposal; review it again." }, { status, ...(status === 503 ? { headers: { "retry-after": "1" } } : {}) });
}
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const scope = { workspaceId: params.get("workspaceId") ?? "", conversationId: params.get("conversationId") ?? "" };
    return Response.json({ proposal: await getStrategyProposal({ ...scope, proposalId: id }), state: await getStrategyState(scope) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

/** Dedicated human confirmation boundary. Never expose this handler or decision SQL as a model tool. */
export async function POST(request: Request, context: Context) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "forbidden" }, { status: 403 });
    const { id } = await context.params;
    const body = proposalDecisionSchema.parse(await request.json().catch(() => null));
    if (body.approval.id !== id) throw new ProposalConflictError();
    const actor = await proposalActor(body.workspaceId);
    const results = await proposalBatch(body.workspaceId, [sql`
      with decision as (
        insert into gtm_proposal_decision (workspace_id, conversation_id, proposal_id, strategy_version, payload_hash, request_id, actor_id, approved)
        select p.workspace_id, p.conversation_id, p.id, p.strategy_version, p.payload_hash, ${body.requestId}, ${actor}, ${body.approval.approved}
        from gtm_proposal p join seo_conversation c on c.id = p.conversation_id and c.workspace_id = p.workspace_id
        where p.id = ${id}::uuid and p.workspace_id = ${body.workspaceId}::uuid and p.conversation_id = ${body.conversationId}::uuid
          and p.strategy_version = ${body.strategyVersion} and p.payload_hash = ${body.payloadHash}
          and ((p.status = 'pending' and p.expires_at > now()) or exists (select 1 from gtm_proposal_decision d where d.workspace_id = p.workspace_id and d.proposal_id = p.id and d.request_id = ${body.requestId}))
        on conflict (workspace_id, request_id) do update set request_id = excluded.request_id
        where gtm_proposal_decision.proposal_id = excluded.proposal_id and gtm_proposal_decision.conversation_id = excluded.conversation_id
          and gtm_proposal_decision.strategy_version = excluded.strategy_version and gtm_proposal_decision.payload_hash = excluded.payload_hash
          and gtm_proposal_decision.actor_id = excluded.actor_id and gtm_proposal_decision.approved = excluded.approved
        returning approved
      ), denied as (
        update gtm_proposal set status = 'denied' where id = ${id}::uuid and workspace_id = ${body.workspaceId}::uuid and conversation_id = ${body.conversationId}::uuid and status = 'pending' and exists (select 1 from decision where not approved)
      ) select approved from decision
    `]);
    if (!rowsOf(results.at(-1)).length) throw new ProposalConflictError();
    if (!body.approval.approved) return Response.json({ proposalId: id, status: "denied" });
    return Response.json(await applyStrategyProposal({ workspaceId: body.workspaceId, conversationId: body.conversationId, proposalId: id, strategyVersion: body.strategyVersion, requestId: body.requestId }));
  } catch (error) { return failure(error); }
}
