import type { SourceProposal, SourceReview } from "@/lib/agents/discovery/proposals";

/*
 * The source quality gate. It runs at proposal time, before anything is stored or ingested, and is deliberately
 * deterministic: the 25 Oct failure was a source whose broad queries pulled in 12 documents with no link to the
 * product, and a model's own confidence in its proposal is not evidence. A source is accepted only when most of its
 * queries share a specific term with the product profile AND the model's own score clears the same threshold.
 */

export const SOURCE_RELEVANCE_THRESHOLD = 0.5;
/** At least this share of a source's queries must name something specific to the product. */
const MIN_SPECIFIC_QUERY_SHARE = 0.5;
const COVERAGE_WEIGHT = 0.6;
const MODEL_WEIGHT = 0.4;

export type ReviewProfile = {
  productName: string;
  description: string;
  category: string;
  audience: string;
  differentiators: string[];
  /** Competitor names or domains the owner accepted, or the agent proposed. */
  competitors: string[];
  /** Keywords the owner accepted, or the agent proposed. */
  keywords: string[];
};

/** Words that fit almost any product. A query made only of these says nothing about this one. */
const GENERIC_TERMS = new Set([
  "ai", "app", "apps", "best", "business", "company", "free", "how", "launch", "make", "new", "news", "online", "platform",
  "product", "products", "saas", "service", "show", "software", "startup", "startups", "tech", "technology", "tool", "tools",
  "top", "web", "what", "why", "automation", "analytics", "data", "hn", "ask", "post", "posts", "tips", "guide", "help",
  "and", "for", "the", "with", "your", "you", "our", "that", "this", "from", "are", "can", "use", "using", "like", "into",
]);

/** Lower-case words of three or more characters with a trailing plural "s" removed, so "tool" and "tools" agree. */
function tokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9][a-z0-9.-]*[a-z0-9]|[a-z0-9]/g) ?? [])
    .flatMap((word) => word.includes(".") ? [word, ...word.split(".")] : [word])
    .map((word) => word.replace(/(?<=[a-z]{3,})s$/, ""))
    .filter((word) => word.length >= 3);
}

const isGeneric = (term: string) => GENERIC_TERMS.has(term) || GENERIC_TERMS.has(`${term}s`);

/** Terms that point at this product: its name, category, audience, differentiators, competitors and keywords. */
export function specificTerms(profile: ReviewProfile): Set<string> {
  const all = [profile.productName, profile.category, profile.audience, profile.description, ...profile.differentiators, ...profile.competitors, ...profile.keywords];
  return new Set(all.flatMap(tokens).filter((term) => !isGeneric(term) && !["com", "dev", "www", "org", "net"].includes(term)));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function reviewSourceProposal(profile: ReviewProfile, source: SourceProposal): SourceReview {
  const vocabulary = specificTerms(profile);
  const reasons: string[] = [];
  const matched = new Set<string>();
  let specific = 0;
  let generic = 0;
  for (const query of source.queries) {
    const words = tokens(query);
    const hits = words.filter((word) => vocabulary.has(word));
    hits.forEach((hit) => matched.add(hit));
    if (hits.length > 0) specific += 1;
    else if (words.every(isGeneric) || words.length === 0) generic += 1;
  }
  const total = source.queries.length;
  const coverage = total === 0 ? 0 : specific / total;
  const model = Math.min(1, Math.max(0, source.relevanceScore));
  const score = round2(COVERAGE_WEIGHT * coverage + MODEL_WEIGHT * model);

  if (specific === 0) reasons.push(generic === total ? "Every query is generic and could match almost any product." : "No query shares a specific term with the product profile.");
  else if (coverage < MIN_SPECIFIC_QUERY_SHARE) reasons.push(`Only ${specific} of ${total} queries name something specific to the product; the rest are generic or unrelated.`);
  if (model < SOURCE_RELEVANCE_THRESHOLD) reasons.push(`The model scored this source ${model.toFixed(2)}, below the ${SOURCE_RELEVANCE_THRESHOLD} threshold.`);
  if (reasons.length === 0 && score < SOURCE_RELEVANCE_THRESHOLD) reasons.push(`Overall relevance ${score.toFixed(2)} is below the ${SOURCE_RELEVANCE_THRESHOLD} threshold.`);

  const accepted = reasons.length === 0;
  if (accepted) reasons.push(`${specific} of ${total} queries match the product profile.`);
  return { accepted, score, threshold: SOURCE_RELEVANCE_THRESHOLD, matchedTerms: [...matched].sort(), reasons };
}
