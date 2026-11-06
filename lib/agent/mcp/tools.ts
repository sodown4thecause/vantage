import { eq } from "drizzle-orm";

import { AGENT_READ_SCOPE } from "@/lib/agent/config";
import type { McpTool } from "@/lib/agent/mcp/protocol";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { getLimits } from "@/lib/plans/limits";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";

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
      return {
        workspace: null,
        message:
          "This credential is not bound to a workspace yet. A human must claim it before " +
          "workspace data is available.",
      };
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

/** Tools available to an agent credential. Read-only until the draft slice lands. */
export function agentTools(): McpTool[] {
  return [getWorkspaceContext];
}
