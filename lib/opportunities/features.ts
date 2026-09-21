import { classifyIntent } from "@/lib/pipeline/intent-ladder";
import type { NormalizedDocument } from "@/lib/pipeline/normalize";
import type {
  OpportunityFeatures,
  OpportunityStatus,
} from "@/lib/opportunities/types";

const BUY_RE =
  /\b(buy|purchase|pricing|subscribe|sign[\s-]?up|checkout|looking for|recommend|alternative)\b/i;

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Stable cluster key from shared tokens across evidence. */
export function clusterKeyForDocuments(
  docs: Array<Pick<NormalizedDocument, "title" | "text" | "platform">>,
): string {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const tokens = new Set(
      tokenize(`${doc.title ?? ""} ${doc.text}`).slice(0, 40),
    );
    for (const t of tokens) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const shared = [...counts.entries()]
    .filter(([, c]) => c >= Math.min(2, docs.length))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([t]) => t);
  const platform = docs[0]?.platform ?? "unknown";
  if (!shared.length) {
    const fallback = tokenize(`${docs[0]?.title ?? ""} ${docs[0]?.text ?? ""}`)
      .slice(0, 3)
      .join("-");
    return `${platform}:${fallback || "singleton"}`;
  }
  return `${platform}:${shared.join("-")}`;
}

export function computeFeatures(
  docs: NormalizedDocument[],
): OpportunityFeatures {
  const intents = docs.map((d) => classifyIntent(d));
  const maxIntent = intents.reduce((m, i) => Math.max(m, i.intentRung), 0);
  const avgConfidence =
    intents.reduce((s, i) => s + i.confidence, 0) / Math.max(intents.length, 1);

  const buyHits = docs.filter((d) =>
    BUY_RE.test(`${d.title ?? ""} ${d.text}`),
  ).length;
  const fit = clamp01(0.35 + buyHits / Math.max(docs.length, 1) * 0.4 + maxIntent / 10);

  const intent = clamp01(maxIntent / 4);
  const evidence = clamp01(Math.log2(1 + docs.length) / 4);
  const platforms = new Set(docs.map((d) => d.platform));
  const momentum = clamp01(
    evidence * 0.6 + platforms.size / 5 + (docs.length >= 5 ? 0.15 : 0),
  );

  const now = Date.now();
  const ages = docs
    .map((d) => (d.postedAt ? now - d.postedAt.getTime() : null))
    .filter((n): n is number => n != null && Number.isFinite(n));
  const newestHours =
    ages.length > 0 ? Math.min(...ages) / (1000 * 60 * 60) : 72;
  const timing = clamp01(1 - newestHours / 168);

  const modelConfidence = clamp01(avgConfidence);
  const lowConfidence = modelConfidence < 0.45 || maxIntent < 2;

  return {
    fit,
    intent,
    evidence,
    momentum,
    timing,
    modelConfidence,
    lowConfidence,
  };
}

export function scoreFeatures(features: OpportunityFeatures): number {
  return (
    features.fit * 0.25 +
    features.intent * 0.3 +
    features.evidence * 0.2 +
    features.momentum * 0.15 +
    features.timing * 0.1
  );
}

export function decideStatus(features: OpportunityFeatures): OpportunityStatus {
  if (features.lowConfidence) return "review";
  const score = scoreFeatures(features);
  if (score >= 0.72 && features.intent >= 0.5) return "opportunity";
  if (score >= 0.45) return "monitor";
  return "ignore";
}

export function recommendedAction(status: OpportunityStatus): string {
  switch (status) {
    case "opportunity":
      return "Draft a grounded reply and open the original thread.";
    case "monitor":
      return "Watch for follow-up posts; revisit if intent rises.";
    case "review":
      return "Human review required — model confidence is low or signals conflict.";
    case "ignore":
    default:
      return "No action — weak fit or low intent.";
  }
}
