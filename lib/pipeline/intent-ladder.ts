import type { NormalizedDocument } from "@/lib/pipeline/normalize";

export type IntentResult = {
  documentId: string;
  intentRung: number;
  confidence: number;
  score: number;
  reason: string;
  factors: Record<string, unknown>;
};

/**
 * Intent ladder v1 — deterministic heuristics so M1 runs without an LLM key.
 * If AI_GATEWAY_URL / OPENAI_API_KEY is present later, swap classifyWithModel.
 *
 * Rungs (higher = stronger buying / recommendation intent):
 * 0 noise · 1 awareness · 2 research · 3 comparison · 4 purchase/recommend
 */
const RULES: Array<{
  rung: number;
  weight: number;
  reason: string;
  pattern: RegExp;
}> = [
  {
    rung: 4,
    weight: 0.95,
    reason: "explicit buy / purchase intent",
    pattern: /\b(buy|purchase|pricing|subscribe|sign up|checkout)\b/i,
  },
  {
    rung: 4,
    weight: 0.9,
    reason: "recommendation request",
    pattern: /\b(recommend|recommendation|what should i use|suggest a)\b/i,
  },
  {
    rung: 3,
    weight: 0.8,
    reason: "tool comparison",
    pattern: /\b(vs\.?|versus|alternative to|compared to|better than)\b/i,
  },
  {
    rung: 3,
    weight: 0.75,
    reason: "looking for a tool/solution",
    pattern: /\b(looking for|anyone know|need a|searching for)\b/i,
  },
  {
    rung: 2,
    weight: 0.6,
    reason: "research / how-to",
    pattern: /\b(how (do|to)|best way|guide|tutorial|monitor|track mentions)\b/i,
  },
  {
    rung: 1,
    weight: 0.4,
    reason: "category awareness",
    pattern: /\b(social listening|brand monitoring|hn|rss|product hunt)\b/i,
  },
];

export function classifyIntent(doc: NormalizedDocument): IntentResult {
  const hay = `${doc.title}\n${doc.text}`;
  let best = {
    rung: 0,
    confidence: 0.15,
    reason: "no intent signals",
    factors: {} as Record<string, unknown>,
  };

  const matched: string[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(hay)) {
      matched.push(rule.reason);
      if (
        rule.rung > best.rung ||
        (rule.rung === best.rung && rule.weight > best.confidence)
      ) {
        best = {
          rung: rule.rung,
          confidence: rule.weight,
          reason: rule.reason,
          factors: { matched },
        };
      }
    }
  }

  const score = Number((best.rung * 20 + best.confidence * 20).toFixed(2));
  return {
    documentId: doc.id,
    intentRung: best.rung,
    confidence: best.confidence,
    score,
    reason: best.reason,
    factors: { ...best.factors, platform: doc.platform },
  };
}

export const DEFAULT_LEAD_THRESHOLD = 2;

export function shouldCreateLead(
  intent: IntentResult,
  threshold = DEFAULT_LEAD_THRESHOLD,
): boolean {
  return intent.intentRung >= threshold;
}
