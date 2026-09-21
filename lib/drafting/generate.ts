export type DraftCitation = {
  label: string;
  url: string;
  documentId?: string;
};

export type DraftFlag = {
  claim: string;
  reason: string;
};

export type DraftInput = {
  productDescription: string;
  targetCustomer: string;
  productMaterialText: string;
  opportunityTitle: string;
  opportunitySummary: string;
  recommendedAction: string;
  evidence: Array<{
    documentId: string;
    title: string | null;
    urlCanonical: string;
    contentMd: string;
    platform: string;
  }>;
};

export type GeneratedDraft = {
  originalText: string;
  citations: DraftCitation[];
  flags: DraftFlag[];
};

const UNSUPPORTED_CLAIM_RE =
  /\b(guaranteed|always|#1|number one|never fails|best in the world|cures?|instant results)\b/i;

/**
 * Deterministic grounded draft (no external model required).
 * Only references workspace product material + opportunity evidence.
 */
export function generateGroundedDraft(input: DraftInput): GeneratedDraft {
  const material = (input.productMaterialText || input.productDescription)
    .trim()
    .slice(0, 800);
  const customer = input.targetCustomer.trim() || "your customers";
  const evidenceLines = input.evidence.slice(0, 5).map((e, i) => {
    const snippet = (e.contentMd || e.title || e.urlCanonical)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    return {
      n: i + 1,
      label: e.title?.trim() || `${e.platform} thread`,
      url: e.urlCanonical,
      documentId: e.documentId,
      snippet,
    };
  });

  const citations: DraftCitation[] = evidenceLines.map((e) => ({
    label: e.label,
    url: e.url,
    documentId: e.documentId,
  }));

  const body = [
    `Re: ${input.opportunityTitle}`,
    "",
    `Saw the discussion about ${input.opportunitySummary.slice(0, 160) || "this topic"}.`,
    "",
    material
      ? `For ${customer}, here's how we approach it based on our product notes: ${material}`
      : `For ${customer}, happy to share how we think about this problem from our product docs once they're filled in.`,
    "",
    evidenceLines.length
      ? "Grounded in these threads:"
      : "No evidence links were available yet.",
    ...evidenceLines.map((e) => `- [${e.n}] ${e.label}: ${e.snippet}`),
    "",
    input.recommendedAction
      ? `Suggested next step: ${input.recommendedAction}`
      : "Suggested next step: reply with a short, specific offer to help.",
    "",
    "Happy to go deeper if useful — no pressure either way.",
  ].join("\n");

  const flags = flagUnsupportedClaims(body);
  const originalText =
    flags.length === 0
      ? body
      : `${body}\n\n[Flagged claims removed/softened before copy: ${flags
          .map((f) => f.claim)
          .join("; ")}]`;

  return {
    originalText: softenFlaggedClaims(originalText, flags),
    citations,
    flags,
  };
}

export function flagUnsupportedClaims(text: string): DraftFlag[] {
  const flags: DraftFlag[] = [];
  const match = text.match(UNSUPPORTED_CLAIM_RE);
  if (match) {
    flags.push({
      claim: match[0],
      reason:
        "Absolute/superlative claim is not grounded in workspace product material.",
    });
  }
  return flags;
}

export function softenFlaggedClaims(
  text: string,
  flags: DraftFlag[],
): string {
  let out = text;
  for (const flag of flags) {
    out = out.replace(new RegExp(escapeRegExp(flag.claim), "ig"), (m) =>
      m.toLowerCase() === "guaranteed"
        ? "designed to"
        : m.toLowerCase().includes("best")
          ? "strong option for"
          : "helps with",
    );
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ensure edited text does not reintroduce blocked absolute claims without flags. */
export function assertCopyAllowed(input: {
  editedText: string;
  flags: DraftFlag[];
}): { ok: true } | { ok: false; error: string } {
  const fresh = flagUnsupportedClaims(input.editedText);
  if (fresh.length > 0) {
    return {
      ok: false,
      error: `Unsupported claims must be removed before copy: ${fresh
        .map((f) => f.claim)
        .join(", ")}`,
    };
  }
  return { ok: true };
}
