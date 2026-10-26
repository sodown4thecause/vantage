import { createUIMessageStream, createUIMessageStreamResponse, consumeStream, toUIMessageStream, type UIMessageChunk } from "ai";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { createGtmAgent, gtmModelHistory, gtmReservationUsd } from "@/lib/gtm/chat/agent";
import { claimGtmTurn, ensureGtmConversation, finishGtmTurn, getGtmTurnStatus, GTM_TURN_TIMEOUT_MS, GtmChatRevisionConflictError, loadGtmChat } from "@/lib/gtm/chat/store";
import { gtmDataSchemas, gtmJsonBytes, GtmChatLimitError, type GtmUIMessage } from "@/lib/gtm/chat/types";
import { consume, release } from "@/lib/plans/limits";
import { runPaidCall } from "@/lib/providers/paid-call";
import { ConversationNotFoundError, getConversation } from "@/lib/seo-agent/conversations";
import { costOfUsage, seoModels } from "@/lib/seo-agent/models";
import { getGtmConversationJobs } from "@/lib/gtm/chat/jobs";
import { getPendingStrategyProposal } from "@/lib/gtm/proposals/repository";

const scopeSchema = z.strictObject({ workspaceId: z.uuid(), conversationId: z.uuid() });
const getSchema = scopeSchema.extend({ requestId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).optional() });
const bodySchema = scopeSchema.extend({ message: z.string().trim().min(1).max(2000), requestId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/), expectedRevision: z.number().int().min(0).max(200), create: z.boolean().optional(), scanRequested: z.boolean().optional(), retryOf: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).optional() });
const QUESTION_LIMIT = "seo_questions_per_month";
const safeError = () => "That didn’t finish. Reload the conversation to recover saved progress.";

export async function GET(req: Request): Promise<Response> {
  const parsed = getSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    if (!(await authorizeWorkspace(parsed.data.workspaceId)).ok) return Response.json({ error: "forbidden" }, { status: 403 });
    const scope = { workspaceId: parsed.data.workspaceId, conversationId: parsed.data.conversationId };
    return Response.json({ ...await loadGtmChat(scope), turn: await getGtmTurnStatus(scope), requestedTurn: parsed.data.requestId ? await getGtmTurnStatus({ ...scope, requestId: parsed.data.requestId }) : null, jobs: await getGtmConversationJobs(scope), proposal: await getPendingStrategyProposal(scope) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "not_found" }, { status: 404 }); }
}

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const input = parsed.data, scope = { workspaceId: input.workspaceId, conversationId: input.conversationId };
  if (input.scanRequested && req.headers.get("origin") !== new URL(req.url).origin) return Response.json({ error: "forbidden" }, { status: 403 });
  let token: string | undefined;
  const quotaPeriod = new Date();
  let quotaReserved = false, attempted = false;
  const refund = async () => { if (quotaReserved && !attempted) { quotaReserved = false; await release(input.workspaceId, QUESTION_LIMIT, 1, quotaPeriod); } };
  try {
    if (!(await authorizeWorkspace(input.workspaceId)).ok) return Response.json({ error: "forbidden" }, { status: 403 });
    if (!input.create && !(await getConversation(input.workspaceId, input.conversationId, "gtm"))) throw new ConversationNotFoundError();
    const models = seoModels();
    if (!models) return Response.json({ error: "not_configured" }, { status: 503 });
    const estimateUsd = gtmReservationUsd(models.executor);
    // Capture real request lifetime support before claiming or charging; absence is not a successful registration.
    const { ctx } = getCloudflareContext();
    const created = input.create ? await ensureGtmConversation({ ...scope, title: input.message }) : false;
    if (input.create && !created && !(await getConversation(input.workspaceId, input.conversationId, "gtm"))) throw new ConversationNotFoundError();
    const claim = await claimGtmTurn(input);
    if (!claim.claimed) return Response.json({ replayed: true, state: claim.state, ...await loadGtmChat(scope) }, { status: 409 });
    token = claim.token!;
    const allowance = await consume(input.workspaceId, QUESTION_LIMIT, 1, quotaPeriod);
    if (!allowance.allowed) {
      await finishGtmTurn({ ...scope, requestId: input.requestId, token, interrupted: true, message: { id: "quota", role: "assistant", parts: [{ type: "text", text: "GTM and SEO share the monthly question allowance. The allowance is exhausted." }, { type: "data-turn", data: { state: "interrupted" } }] } });
      token = undefined;
      return Response.json({ error: "quota_exhausted", message: "GTM and SEO share the monthly question allowance." }, { status: 429 });
    }
    quotaReserved = true;
    const { messages } = await loadGtmChat(scope);
    const controller = new AbortController();
    const signal = AbortSignal.any([req.signal, controller.signal, AbortSignal.timeout(GTM_TURN_TIMEOUT_MS)]);
    let complete = false;
    const ownerToken = token;
    const stream = createUIMessageStream<GtmUIMessage>({
      originalMessages: [],
      onError: safeError,
      execute: async ({ writer }) => {
        try {
          await runPaidCall({ context: { workspaceId: input.workspaceId, sourceKey: "gtm" }, provider: "gateway", action: "gtm_chat", estimateUsd, signal }, async () => {
            attempted = true;
            const result = await createGtmAgent({ ...scope, signal, turn: { requestId: input.requestId, token: ownerToken } }).stream({ messages: gtmModelHistory(messages), abortSignal: signal });
            let failed = false, bytes = 0, parts = 0;
            const reader = toUIMessageStream({ stream: result.stream, sendReasoning: false, sendSources: false, onError: safeError }).getReader();
            let abortRead: () => void;
            const aborted = new Promise<never>((_resolve, reject) => { abortRead = () => reject(signal.reason); signal.addEventListener("abort", abortRead, { once: true }); });
            try {
              signal.throwIfAborted();
              while (true) {
                const { done, value } = await Promise.race([reader.read(), aborted]);
                if (done) break;
                let chunk: UIMessageChunk | undefined;
                if (value.type === "tool-output-available") {
                  const proposal = gtmDataSchemas.proposal.safeParse(value.output), job = gtmDataSchemas.job.safeParse(value.output), card = gtmDataSchemas.card.safeParse(value.output);
                  if (proposal.success) chunk = { type: "data-proposal", id: proposal.data.id, data: proposal.data };
                  else if (job.success) chunk = { type: "data-job", id: job.data.id, data: job.data };
                  else if (card.success) chunk = { type: "data-card", data: card.data };
                } else if (["start", "text-start", "text-delta", "text-end", "error", "abort"].includes(value.type)) chunk = value;
                if (value.type === "error" || value.type === "abort") failed = true;
                if (chunk) {
                  bytes += gtmJsonBytes(chunk);
                  if (chunk.type === "text-start" || chunk.type.startsWith("data-")) parts++;
                  if (bytes > 26_000 || parts > 60) { controller.abort(); throw new Error("Response limit reached"); }
                  writer.write(chunk as Parameters<typeof writer.write>[0]);
                }
              }
              signal.throwIfAborted();
              if (failed) throw new Error("Generation interrupted");
              const usage = await result.totalUsage;
              const costUsd = costOfUsage(models.executor, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.inputTokenDetails.cacheReadTokens });
              return { value: undefined, costUsd };
            } finally {
              signal.removeEventListener("abort", abortRead!);
              if (signal.aborted) void reader.cancel().catch(() => {});
              reader.releaseLock();
            }
          });
          complete = true;
          writer.write({ type: "data-turn", data: { state: "complete" } });
          writer.write({ type: "finish", finishReason: "stop" });
        } catch {
          controller.abort();
          await refund();
          writer.write({ type: "data-turn", data: { state: "interrupted" } });
          writer.write({ type: "error", errorText: safeError() });
        }
      },
      onEnd: async ({ responseMessage, isAborted, isCancelled }) => {
        const interrupted = !complete || isAborted || Boolean(isCancelled);
        const parts = responseMessage.parts.filter(part => part.type !== "step-start").map(part => part.type === "text" ? { type: "text" as const, text: part.text, state: "done" as const } : part);
        if (!parts.length) parts.push({ type: "text", text: safeError(), state: "done" });
        await finishGtmTurn({ ...scope, requestId: input.requestId, token: ownerToken, interrupted, message: { id: responseMessage.id, role: "assistant", parts } });
      },
    });
    return createUIMessageStreamResponse({ stream, headers: { "Cache-Control": "no-store", "X-Gtm-Conversation-Id": input.conversationId }, consumeSseStream: ({ stream }) => {
      // One UI tee keeps consumption, ledger settlement and persistence inside the Worker request lifetime.
      ctx.waitUntil(consumeStream({ stream, onError: () => { console.error("[gtm chat] completion failed"); } }));
    } });
  } catch (error) {
    console.error("[gtm chat] request failed", { category: error instanceof ConversationNotFoundError ? "not_found" : "unexpected" });
    try {
      await refund();
      if (token) await finishGtmTurn({ ...scope, requestId: input.requestId, token, interrupted: true, message: { id: "failed", role: "assistant", parts: [{ type: "text", text: safeError() }, { type: "data-turn", data: { state: "interrupted" } }] } });
    } catch { console.error("[gtm chat] recovery pending"); }
    return Response.json({ error: error instanceof GtmChatRevisionConflictError ? "conversation_changed" : error instanceof GtmChatLimitError ? "conversation_limit" : error instanceof ConversationNotFoundError ? "not_found" : "request_failed" }, { status: error instanceof GtmChatRevisionConflictError ? 409 : error instanceof ConversationNotFoundError ? 404 : error instanceof GtmChatLimitError ? 413 : 500 });
  }
}
