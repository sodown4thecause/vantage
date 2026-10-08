import type { NormalizedDocument } from "@/lib/pipeline/normalize";

/**
 * Situation classifier, stage 1 (S70). Deterministic and pure: tags what is
 * happening in a post so a play can be chosen. A model stage may refine
 * candidates later; this stage never calls one.
 */
export const SITUATIONS = [
  "breakage",
  "migration",
  "price_pain",
  "alternative_request",
  "evaluation",
  "integration_gap",
  "free_tier_request",
  "built_it_myself",
  "team_need",
  "production_check",
  "tool_request",
  "how_solved",
  "other",
] as const;

export type Situation = (typeof SITUATIONS)[number];

/** Half-life in days: how fast a situation stops being worth acting on. */
export const SITUATION_HALF_LIFE_DAYS: Record<Situation, number> = {
  breakage: 2,
  migration: 7,
  price_pain: 7,
  alternative_request: 7,
  evaluation: 10,
  integration_gap: 14,
  free_tier_request: 7,
  built_it_myself: 21,
  team_need: 14,
  production_check: 14,
  tool_request: 10,
  how_solved: 30,
  other: 14,
};

/** Higher means more commercially meaningful. */
const SITUATION_INTENT: Record<Situation, number> = {
  breakage: 0.7,
  migration: 0.95,
  price_pain: 0.85,
  alternative_request: 0.9,
  evaluation: 0.85,
  integration_gap: 0.7,
  free_tier_request: 0.75,
  built_it_myself: 0.6,
  team_need: 0.85,
  production_check: 0.6,
  tool_request: 0.8,
  how_solved: 0.45,
  other: 0.1,
};

// Order matters: the first matching pattern wins, most specific first.
const PATTERNS: Array<{ situation: Situation; pattern: RegExp }> = [
  {
    situation: "migration",
    pattern:
      /\b(migrat(e|ing|ion) (away )?from|moving (away )?from|switching (away )?from|leaving|dropping|ditching)\b/i,
  },
  {
    situation: "price_pain",
    pattern:
      /\b(too expensive|getting expensive|price (hike|increase)|paying too much|costs? too much|can'?t afford|pricing (change|went up))\b/i,
  },
  {
    situation: "breakage",
    pattern:
      /\b(just (broke|removed|deprecated)|removed (the )?(feature|support)|no longer (works?|supports?)|is broken|breaking change|sunset(ting)?)\b/i,
  },
  {
    situation: "evaluation",
    pattern: /\b(\w+ vs\.? \w+ vs\.? \w+|evaluating|comparing|which (one )?(should|to) (i )?(choose|pick|use))\b/i,
  },
  {
    situation: "alternative_request",
    pattern:
      /\b(alternatives? to|open[- ]source (alternative|version)|anything (like|similar to)|replacement for|instead of)\b/i,
  },
  {
    situation: "free_tier_request",
    pattern: /\b(free (tier|trial|plan|credits?)|any free|trial (available|period))\b/i,
  },
  {
    situation: "integration_gap",
    pattern:
      /\b(integrat(e|es|ion) with|(connect|sync) \w+ (to|with|and) \w+|does anything (integrate|connect|work with))\b/i,
  },
  {
    situation: "built_it_myself",
    pattern:
      /\b(i (built|wrote|made) (this|my own|a script)|nothing (exists|out there)|rolled my own|built it myself)\b/i,
  },
  {
    situation: "team_need",
    pattern: /\b(our team (needs|is looking)|we (need|are looking for)|for our (team|company))\b/i,
  },
  {
    situation: "production_check",
    pattern: /\b(in production|production[- ]ready|anyone (using|running)|battle[- ]tested)\b/i,
  },
  {
    situation: "tool_request",
    pattern:
      /\b(what tool|which tool|any tool|tool (for|that)|looking for (a|an) |recommend(ation)?s? (for|a)|anyone know (of )?(a|an))\b/i,
  },
  {
    situation: "how_solved",
    pattern: /\b(how (are|do) (you|people|folks)|what('s| is) your (setup|workflow)|best way to)\b/i,
  },
];

export type SituationResult = {
  documentId: string;
  situation: Situation;
  /** 0 to 1, intent strength for the matched situation. */
  intent: number;
  /** Other situations that also matched, strongest first. */
  secondary: Situation[];
  /** Freshness multiplier in (0, 1]; 1 when `postedAt` is unknown. */
  freshness: number;
  /** Intent x freshness. */
  score: number;
};

export function freshnessFor(
  situation: Situation,
  postedAt: Date | null,
  now: Date = new Date(),
): number {
  if (!postedAt) return 1;
  const ageDays = Math.max(0, (now.getTime() - postedAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / SITUATION_HALF_LIFE_DAYS[situation]);
}

export function classifySituation(
  doc: Pick<NormalizedDocument, "id" | "title" | "text" | "postedAt">,
  now: Date = new Date(),
): SituationResult {
  const hay = `${doc.title}\n${doc.text}`;
  const matched = PATTERNS.filter((p) => p.pattern.test(hay)).map(
    (p) => p.situation,
  );
  const situation: Situation = matched[0] ?? "other";
  const freshness = freshnessFor(situation, doc.postedAt, now);
  const intent = SITUATION_INTENT[situation];
  return {
    documentId: doc.id,
    situation,
    intent,
    secondary: matched.slice(1),
    freshness: Number(freshness.toFixed(4)),
    score: Number((intent * freshness).toFixed(4)),
  };
}
