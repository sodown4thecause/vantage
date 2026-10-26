import { listOpportunityQueue } from "@/lib/opportunities/run";
import type { OpportunityCardView } from "@/lib/opportunities/types";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import type { MonitoringProfileView } from "@/lib/profile/types";

export const FALLBACK_SUGGESTED_PROMPTS = [
  "Draft a practical post that helps our audience solve a problem they are facing this week. Prioritise one clear takeaway and use Australian English.",
  "Turn one of our product's key topics into a useful explanation for our target customers. Keep it balanced and use Australian English.",
  "Write a concise perspective on a current trend in our space, with a specific next step readers can try. Use Australian English.",
] as const;

type BuildSuggestedPromptsArgs = {
  workspaceId: string;
  opportunities: OpportunityCardView[];
  profile: MonitoringProfileView | null;
};

function clean(value: string, maxLength = 140): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function buildSuggestedPrompts({ workspaceId, opportunities, profile }: BuildSuggestedPromptsArgs): string[] {
  if (!profile || profile.workspaceId !== workspaceId) return [...FALLBACK_SUGGESTED_PROMPTS];

  const keywords = profile.topics.map((topic) => clean(topic, 80)).filter(Boolean);
  const rankedOpportunities = [...opportunities]
    .filter((opportunity) => opportunity.workspaceId === workspaceId)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, 3);

  if (!keywords.length || !rankedOpportunities.length) return [...FALLBACK_SUGGESTED_PROMPTS];

  const audience = clean(profile.targetCustomer) || "our audience";
  return Array.from({ length: 3 }, (_, index) => {
    const opportunity = rankedOpportunities[index % rankedOpportunities.length]!;
    const keyword = keywords[index % keywords.length]!;
    const title = clean(opportunity.title);
    if (index === 0) {
      return `Write a practical post for ${audience} about ${keyword}, using “${title}” as a timely starting point. Prioritise one clear takeaway and use Australian English.`;
    }
    if (index === 1) {
      return `Explain how ${keyword} could help ${audience} respond to “${title}”. Keep the advice balanced, specific and in Australian English.`;
    }
    return `Create a concise FAQ for ${audience} about ${keyword}, answering the need behind “${title}” with one useful next step. Use Australian English.`;
  });
}

export async function getContentSuggestedPrompts(workspaceId: string): Promise<string[]> {
  const [opportunities, profile] = await Promise.all([
    listOpportunityQueue({ workspaceId, limit: 3 }),
    getLatestMonitoringProfile(workspaceId),
  ]);
  return buildSuggestedPrompts({ workspaceId, opportunities, profile });
}
