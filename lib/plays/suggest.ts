import type { Play } from "@/lib/db/schema";
import type { Situation } from "@/lib/pipeline/situation";

export type PlayKind = Play["kind"];
export type PlayEffort = Play["effortEstimate"];

/**
 * What the venue allows, from the community rules index (S30). Community risk
 * is a gate on the action, not a weight on the rank.
 */
export const VENUE_MODES = [
  "link_ok",
  "link_if_asked",
  "no_link",
  "brief_only",
] as const;
export type VenueMode = (typeof VENUE_MODES)[number];

export type PlaySuggestion = {
  kind: PlayKind;
  title: string;
  rationale: string;
  effort: PlayEffort;
  /** How the play may mention the product in the venue; null for plays that are not posted in a venue. */
  linkPolicy: VenueMode | null;
  /** False when the venue bans AI-written text: the user gets a brief, never a draft. */
  draftAllowed: boolean;
};

export type SuggestPlaysInput = {
  situation: Situation;
  venueMode: VenueMode;
  /** True when the product has docs or material the brief can cite. */
  productHasDocs: boolean;
};

type Template = {
  kind: PlayKind;
  title: string;
  rationale: string;
  effort: PlayEffort;
  /** Optional floor on link strictness for this situation, whatever the venue allows. */
  atLeast?: VenueMode;
};

const STRICTNESS: Record<VenueMode, number> = {
  link_ok: 0,
  link_if_asked: 1,
  no_link: 2,
  brief_only: 3,
};

function stricter(a: VenueMode, b: VenueMode): VenueMode {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

const BRIEF: Template = {
  kind: "reply_brief",
  title: "Answer the thread",
  rationale: "Answer the question with something useful.",
  effort: "s",
};

/** Default play first, then supporting plays. */
const TEMPLATES: Record<Situation, Template[]> = {
  tool_request: [
    { ...BRIEF, title: "Answer the tool question", rationale: "The author asked what tool to use." },
  ],
  alternative_request: [
    { ...BRIEF, title: "Answer the alternatives question", rationale: "The author asked for an alternative." },
    { kind: "comparison_page", title: "Publish a comparison page", rationale: "People keep asking for alternatives; a comparison page answers them for good.", effort: "m" },
    { kind: "directory_submission", title: "List on alternatives directories", rationale: "Alternatives sites are where this search ends up.", effort: "s" },
  ],
  price_pain: [
    { ...BRIEF, title: "Reply with a pricing comparison", rationale: "The author is unhappy with a price; a factual comparison helps them decide." },
    { kind: "comparison_page", title: "Publish a pricing comparison", rationale: "Price complaints tend to cluster; a page captures them.", effort: "m" },
  ],
  migration: [
    { kind: "migration_guide", title: "Write a migration guide", rationale: "The author is leaving a tool; a step-by-step guide removes the switching cost.", effort: "m" },
    { kind: "importer", title: "Build or document an importer", rationale: "An importer is the strongest answer to a migration.", effort: "l" },
    { ...BRIEF, title: "Answer the migration thread", rationale: "The author is mid-migration right now." },
  ],
  integration_gap: [
    { ...BRIEF, title: "Answer the integration question", rationale: "The author wants two tools connected." },
    { kind: "integration", title: "Count toward an integration", rationale: "Repeated requests to connect the same tools justify building the integration.", effort: "l" },
  ],
  built_it_myself: [
    { ...BRIEF, title: "Reply with product evidence", rationale: "The author built this by hand because nothing fit; show the feature that covers it." },
  ],
  free_tier_request: [
    { ...BRIEF, title: "Answer the free tier question", rationale: "The author asked about a free tier or trial." },
    { kind: "trial_offer", title: "Offer a trial", rationale: "A trial removes the main objection raised.", effort: "m" },
  ],
  breakage: [
    { ...BRIEF, title: "Reply while it is fresh", rationale: "Time-sensitive: a breakage thread loses value within days." },
  ],
  how_solved: [
    // Education angle: no link by default, whatever the venue allows.
    { ...BRIEF, title: "Share how you solve it", rationale: "Educational angle; the author is not shopping yet.", atLeast: "no_link" },
  ],
  evaluation: [
    { ...BRIEF, title: "Join the evaluation", rationale: "The author is comparing options now." },
    { kind: "comparison_page", title: "Publish a comparison page", rationale: "Evaluations repeat; a comparison page serves the next one.", effort: "m" },
  ],
  team_need: [
    { ...BRIEF, title: "Answer the team's need", rationale: "A team is looking, which carries more commercial weight." },
  ],
  production_check: [
    { ...BRIEF, title: "Share your production experience", rationale: "The author wants production evidence, and your docs have some." },
  ],
  other: [],
};

function linkedTitle(template: Template, mode: VenueMode): { title: string; rationale: string } {
  switch (mode) {
    case "link_ok":
      return {
        title: template.title,
        rationale: `${template.rationale} The venue allows a link where it helps.`,
      };
    case "link_if_asked":
      return {
        title: template.title,
        rationale: `${template.rationale} Link only if someone asks.`,
      };
    case "no_link":
      return {
        title: template.title,
        rationale: `${template.rationale} Do not include a link or name the product.`,
      };
    case "brief_only":
      return {
        title: `${template.title} (brief only)`,
        rationale: `${template.rationale} This venue bans AI-written text: use the brief to write it yourself, no draft.`,
      };
  }
}

/** Why `suggestPlays` returned nothing, or null when it did return plays. */
export function noPlayReason(
  input: Pick<SuggestPlaysInput, "situation" | "productHasDocs">,
): string | null {
  if (input.situation === "other") {
    return "No play fits this conversation; it is ranked by its other signals.";
  }
  if (input.situation === "production_check" && !input.productHasDocs) {
    return "Skip: this asks for production experience and your docs show none.";
  }
  return null;
}

/**
 * Pure: default play per situation (plan section 4), with the venue mode
 * gating how a reply may mention the product.
 */
export function suggestPlays(input: SuggestPlaysInput): PlaySuggestion[] {
  if (noPlayReason(input)) return [];
  return TEMPLATES[input.situation].map((template) => {
    // The venue gate only applies to what is posted in the venue; plays on
    // the user's own site or other destinations are unaffected.
    if (template.kind !== "reply_brief") {
      return {
        kind: template.kind,
        title: template.title,
        rationale: template.rationale,
        effort: template.effort,
        linkPolicy: null,
        draftAllowed: true,
      };
    }
    const linkPolicy = stricter(input.venueMode, template.atLeast ?? "link_ok");
    const { title, rationale } = linkedTitle(template, linkPolicy);
    return {
      kind: template.kind,
      title,
      rationale,
      effort: template.effort,
      linkPolicy,
      draftAllowed: linkPolicy !== "brief_only",
    };
  });
}
