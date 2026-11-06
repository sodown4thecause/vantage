import { eq } from "drizzle-orm";

import { AGENT_DRAFT_SCOPE, AGENT_READ_SCOPE } from "@/lib/agent/config";
import type { McpTool } from "@/lib/agent/mcp/protocol";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { DraftInputError, generateDraftForOpportunity } from "@/lib/drafting/repository";
import { contributionRule } from "@/lib/drafting/rules";
import { getOpportunityDetail } from "@/lib/opportunities/run";
import { getLimits } from "@/lib/plans/limits";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { ensureTodaysPicks } from "@/lib/retention/picks";
import { workspaceTimeZone } from "@/lib/retention/zone";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Response budget. A cluster can hold hundreds of documents, each with replies,
 * so per-post caps alone are not enough: the total is what protects the model's
 * context and the response time.
 */
const MAX_EVIDENCE_ITEMS = 5;
const MAX_EVIDENCE_CHARS = 6_000;
const MAX_REPLY_CHARS = 1_000;
const MAX_TOTAL_TEXT_CHARS = 24_000;

type EvidenceText = { content: string; truncated: boolean; existingReplies: string[] };

/**
 * Fills one shared text budget across posts and replies, in order. Once the
 * budget is spent the remaining posts keep their metadata but carry no text, so
 * the caller can see what was omitted instead of silently losing it.
 */
function budgetEvidence(
  items: Array<{ contentMd: string; existingReplies?: string[] }>,
): EvidenceText[] {
  let remaining = MAX_TOTAL_TEXT_CHARS;
  return items.map((item) => {
    const content = item.contentMd.slice(0, Math.min(MAX_EVIDENCE_CHARS, Math.max(remaining, 0)));
    remaining -= content.length;
    const replies: string[] = [];
    for (const reply of item.existingReplies ?? []) {
      if (remaining <= 0) break;
      const text = reply.slice(0, Math.min(MAX_REPLY_CHARS, remaining));
      remaining -= text.length;
      replies.push(text);
    }
    return {
      content,
      truncated: content.length < item.contentMd.length,
      existingReplies: replies,
    };
  });
}

const round = (value: number) => Number(value.toFixed(2));

const NO_WORKSPACE =
  "This credential is not bound to a workspace yet. A human must claim it before " +
  "workspace data is available.";

const getWorkspaceContext: McpTool = {
  name: "get_workspace_context",
  title: "Get workspace context",
  description:
    "The product this workspace tracks: its description, target customer, competitors, " +
    "topics and plan limits. Call this first so later answers use the right context.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  requiredScope: AGENT_READ_SCOPE,
  async run(_input, ctx) {
    if (!ctx.workspaceId) {
      return { workspace: null, message: NO_WORKSPACE };
    }
    const [row] = await getDb()
      .select({ id: workspace.id, name: workspace.name, plan: workspace.plan })
      .from(workspace)
      .where(eq(workspace.id, ctx.workspaceId))
      .limit(1);
    if (!row) {
      return { workspace: null, message: "This workspace no longer exists." };
    }
    const [profile, limits] = await Promise.all([
      getLatestMonitoringProfile(row.id),
      getLimits(row.plan),
    ]);
    return {
      workspace: { id: row.id, name: row.name, plan: row.plan },
      profile: profile
        ? {
            version: profile.version,
            productUrl: profile.productUrl,
            productDescription: profile.productDescription,
            targetCustomer: profile.targetCustomer,
            competitors: profile.competitors,
            topics: profile.topics,
          }
        : null,
      limits: {
        projects: limits.projects,
        sources: limits.sources,
        scoredLeadsPerDay: limits.scored_leads_per_day,
        scanIntervalHours: limits.scan_interval_hours,
      },
      posting: "Vantage never posts, replies or messages on anyone's behalf.",
    };
  },
};

const listTodaysConversations: McpTool = {
  name: "list_todays_conversations",
  title: "List today's ranked conversations",
  description:
    "Up to five conversations worth joining today, best first, each with its score, why it " +
    "matters, why now and the suggested next step. This is the same list the workspace owner " +
    "sees. Read-only: nothing is posted or sent.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  requiredScope: AGENT_READ_SCOPE,
  async run(_input, ctx) {
    if (!ctx.workspaceId) return { conversations: [], message: NO_WORKSPACE };

    const timeZone = await workspaceTimeZone(ctx.workspaceId);
    // Same call the queue page makes: it fixes the day's list on first use, which
    // is bookkeeping about what was shown, never user content.
    const { day, cards } = await ensureTodaysPicks({ workspaceId: ctx.workspaceId, timeZone });

    return {
      day,
      timeZone,
      conversations: cards.map((card) => ({
        id: card.id,
        title: card.title,
        status: card.status,
        score: round(card.score),
        confidence: round(card.confidence),
        evidenceCount: card.evidenceCount,
        whyItMatters: card.whyItMatters,
        whyNow: card.whyNow,
        recommendedAction: card.recommendedAction,
      })),
      ...(cards.length === 0
        ? {
            message:
              "No conversation has been picked for today yet. The workspace may not have " +
              "finished a scan, or nothing scored high enough.",
          }
        : {}),
    };
  },
};

const getConversation: McpTool = {
  name: "get_conversation",
  title: "Get one conversation with its evidence",
  description:
    "One conversation from today's list, with the original posts behind it so a reply can be " +
    "grounded in what was actually said. Read-only.",
  inputSchema: {
    type: "object",
    properties: {
      opportunityId: {
        type: "string",
        description: "The id from list_todays_conversations.",
      },
    },
    required: ["opportunityId"],
    additionalProperties: false,
  },
  requiredScope: AGENT_READ_SCOPE,
  async run(input, ctx) {
    if (!ctx.workspaceId) return { conversation: null, message: NO_WORKSPACE };

    const opportunityId = typeof input.opportunityId === "string" ? input.opportunityId.trim() : "";
    if (!UUID.test(opportunityId)) {
      return { conversation: null, message: "opportunityId must be a conversation id." };
    }

    // Scoped by the credential's workspace, never by anything the caller sent.
    const detail = await getOpportunityDetail({ workspaceId: ctx.workspaceId, opportunityId });
    if (!detail) {
      return {
        conversation: null,
        message:
          "No such conversation in this workspace. It may have been retired, or it belongs " +
          "to another workspace.",
      };
    }

    const shown = detail.evidence.slice(0, MAX_EVIDENCE_ITEMS);
    const texts = budgetEvidence(shown);
    const omitted = detail.evidence.length - shown.length;

    return {
      conversation: {
        id: detail.id,
        title: detail.title,
        status: detail.status,
        score: round(detail.score),
        confidence: round(detail.confidence),
        summary: detail.summary,
        whyItMatters: detail.whyItMatters,
        whyNow: detail.whyNow,
        recommendedAction: detail.recommendedAction,
        evidence: shown.map((item, index) => ({
          documentId: item.documentId,
          title: item.title,
          url: item.urlCanonical,
          platform: item.platform,
          postedAt: item.postedAt,
          contentKind: item.contentKind ?? null,
          subreddit: item.subreddit ?? null,
          score: item.score ?? null,
          existingReplies: texts[index]!.existingReplies,
          content: texts[index]!.content,
          truncated: texts[index]!.truncated,
        })),
        evidenceCount: detail.evidence.length,
        omittedEvidence: omitted,
      },
      ...(omitted > 0
        ? {
            message:
              `${omitted} more ${omitted === 1 ? "post is" : "posts are"} in this conversation but ` +
              `not shown. Ask for a specific post if you need it.`,
          }
        : {}),
      posting: "Vantage never posts, replies or messages on anyone's behalf.",
    };
  },
};

const draftReply: McpTool = {
  name: "draft_reply",
  title: "Draft a reply",
  description:
    "Draft a reply to one conversation, grounded in the posts behind it. Returns text only: " +
    "nothing is saved, sent or posted. A human must check the community's rules, edit the text " +
    "and post it themselves. Venues that prohibit AI-written contributions return a research " +
    "brief instead.",
  inputSchema: {
    type: "object",
    properties: {
      opportunityId: {
        type: "string",
        description: "The id from list_todays_conversations.",
      },
      targetDocumentId: {
        type: "string",
        description: "Optional: which post in the thread to reply to. Defaults to the first.",
      },
    },
    required: ["opportunityId"],
    additionalProperties: false,
  },
  requiredScope: AGENT_DRAFT_SCOPE,
  async run(input, ctx) {
    if (!ctx.workspaceId) return { draft: null, message: NO_WORKSPACE };

    const opportunityId = typeof input.opportunityId === "string" ? input.opportunityId.trim() : "";
    if (!UUID.test(opportunityId)) {
      return { draft: null, message: "opportunityId must be a conversation id." };
    }
    const targetDocumentId =
      typeof input.targetDocumentId === "string" ? input.targetDocumentId.trim() : "";
    if (targetDocumentId && !UUID.test(targetDocumentId)) {
      return { draft: null, message: "targetDocumentId must be a document id." };
    }

    try {
      const { detail, target, generated } = await generateDraftForOpportunity({
        workspaceId: ctx.workspaceId,
        opportunityId,
        ...(targetDocumentId ? { targetDocumentId } : {}),
        // Text for a human to review, never persisted and never handed off.
        draftForReview: true,
      });
      const rule = contributionRule(target.platform, target.urlCanonical);
      return {
        draft: {
          text: generated.originalText,
          kind: generated.quality?.kind ?? "draft",
          citations: generated.citations,
          flags: generated.flags,
          venue: rule.venue,
          venuePolicy: rule.aiText,
          rulesReviewed: false,
        },
        conversation: { id: detail.id, title: detail.title },
        warning:
          "Text only. Nothing was saved or sent. Check this community's rules and edit before " +
          "posting.",
      };
    } catch (err) {
      if (err instanceof DraftInputError) return { draft: null, message: err.message };
      throw err;
    }
  },
};

/** Tools available to an agent credential. Read and draft only; nothing writes or sends. */
export function agentTools(): McpTool[] {
  return [getWorkspaceContext, listTodaysConversations, getConversation, draftReply];
}
