import type { Category, FollowUps } from "./chat-wire";

export type JourneyChip = {
  category: Category;
  text: string;
  costLabel: string;
  recommended?: boolean;
  reason?: string;
};

type JourneyInput = {
  focus: "seo" | "geo";
  starters: JourneyChip[];
  followUps?: FollowUps;
  latestTools?: string[];
};

const FALLBACK: Record<Category, string> = {
  seo: "Help me choose a focused search research question",
  geo: "Help me plan research into AI answers about my product",
  content: "Help me turn the research into a useful content brief",
};

function recommendCategory(focus: "seo" | "geo", latestTools: string[]): Category {
  if (focus === "geo") return "geo";
  if (latestTools.some((tool) => tool === "llm_response" || tool === "ai_keyword_volume")) return "seo";
  if (latestTools.some((tool) => tool === "ranked_keywords" || tool === "google_serp" || tool === "keyword_ideas")) return "geo";
  if (latestTools.some((tool) => tool === "backlink_gap" || tool === "referring_domains")) return "content";
  return "seo";
}

function reasonFor(category: Category, focus: "seo" | "geo", latestTools: string[], starter?: JourneyChip): string {
  if (starter?.reason) return starter.reason;
  if (focus === "geo" && category === "geo") {
    return "You are in GEO research — start with whether AI answers mention you.";
  }
  if (latestTools.includes("ranked_keywords") && category === "geo") {
    return "You already saw rankings — check whether AI answers mention you next.";
  }
  if (latestTools.includes("llm_response") && category === "seo") {
    return "You checked AI answers — next find the search phrases still open.";
  }
  if (category === "seo") return "A focused search check to ground the next decision.";
  if (category === "geo") return "Checks whether AI assistants mention tools like yours.";
  return "Turns the latest findings into a practical research brief.";
}

/**
 * Exactly three dock actions. Follow-ups never claim a free cost. Older messages without recommendation
 * metadata still get exactly one Recommended label via deterministic fallback.
 */
export function journeyActionsFromClient(input: JourneyInput): JourneyChip[] {
  const order: Category[] = input.focus === "geo" ? ["geo", "seo", "content"] : ["seo", "geo", "content"];
  const latestTools = input.latestTools ?? [];
  // A starter's reason describes the starter's question, so it applies only while that question is the one shown.
  const shownStarter = (chip: JourneyChip) =>
    input.starters.find((item) => item.category === chip.category && item.text === chip.text);
  const chips = order.map((category) => {
    const fromFollowUp = input.followUps?.[category]?.trim();
    if (fromFollowUp) return { category, text: fromFollowUp, costLabel: "" };
    const starter = input.starters.find((chip) => chip.category === category);
    if (starter) return { ...starter };
    return { category, text: FALLBACK[category], costLabel: "" };
  });

  // Empty starters already on empty chat: prefer any recommended starter metadata when present.
  if (!input.followUps && input.starters.some((chip) => chip.recommended)) {
    const recommended = input.starters.find((chip) => chip.recommended)?.category
      ?? recommendCategory(input.focus, latestTools);
    return chips.map((chip) => {
      if (chip.category !== recommended) {
        const { recommended: _r, reason: _reason, ...rest } = chip;
        return rest;
      }
      const starter = shownStarter(chip);
      return {
        ...chip,
        recommended: true,
        reason: reasonFor(chip.category, input.focus, latestTools, starter),
      };
    });
  }

  const pick = recommendCategory(input.focus, latestTools);
  return chips.map((chip) => {
    if (chip.category !== pick) {
      const { recommended: _r, reason: _reason, ...rest } = chip;
      return rest;
    }
    const starter = shownStarter(chip);
    return {
      ...chip,
      recommended: true,
      reason: reasonFor(chip.category, input.focus, latestTools, starter),
    };
  });
}
