import type { SourceReview } from "@/lib/agents/discovery/proposals";
import type { SkippedSources } from "@/lib/profile/types";

/** How many topics the relevance gate looks at when it decides on a profile's default sources. */
export const GATED_TOPIC_COUNT = 5;

/**
 * What the owner is told when saving a profile did not create the default sources: which topics were looked at, why
 * they failed, and what to do next. Absent when the gate accepted the topics. Written in Australian English.
 */
export function skippedSourcesNotice(topics: string[], review: SourceReview): SkippedSources | undefined {
  if (review.accepted) return undefined;
  const looked = topics.slice(0, GATED_TOPIC_COUNT);
  const reasons = review.reasons.length ? review.reasons : ["The topics did not look specific enough to this product."];
  const named = looked.map((topic) => `"${topic}"`).join(", ");
  return {
    topics: looked,
    reasons,
    message: `We didn’t set up default sources from these topics: ${named}. ${reasons.join(" ")} Your profile is saved. Add more specific topics, or add sources yourself on the Sources page.`,
  };
}
