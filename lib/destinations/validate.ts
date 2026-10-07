import {
  destinationAiCitedValues,
  destinationCostValues,
  destinationKindValues,
  destinationLinkAttrValues,
  destinationListingModeValues,
  destinationSubmissionsOpenValues,
  type NewDestination,
} from "@/lib/db/schema";
import { safeHttpUrl } from "@/lib/http/safe-url";

/** Row shape accepted from data/destinations.json (before it becomes a DB insert). */
export type DestinationInput = Omit<NewDestination, "id">;

export type DestinationValidation =
  | { ok: true; row: DestinationInput }
  | { ok: false; errors: string[] };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function oneOf<T extends string>(
  errors: string[],
  field: string,
  value: unknown,
  allowed: readonly T[],
  fallback?: T,
): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  errors.push(`${field} must be one of: ${allowed.join(", ")}`);
  return fallback ?? allowed[0];
}

function tags(errors: string[], field: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((t) => typeof t !== "string" || !t.trim())) {
    errors.push(`${field} must be an array of non-empty strings`);
    return [];
  }
  return value.map((t: string) => t.trim());
}

function validDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Pure validation of one catalog row. A row is rejected without a primary `source_url` or a
 * `last_verified` date. "unknown" is allowed for every enumerated fact; `ai_cited: "yes"` needs
 * recorded evidence. Never guesses: missing optional facts become "unknown".
 */
export function validateDestination(input: unknown): DestinationValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["row must be an object"] };

  const slug = str(input.slug);
  if (!SLUG.test(slug)) errors.push("slug must be lowercase letters, digits and hyphens");
  const name = str(input.name);
  if (!name) errors.push("name is required");

  const url = safeHttpUrl(str(input.url));
  if (!url) errors.push("url must be an http(s) URL");

  const sourceUrl = safeHttpUrl(str(input.sourceUrl));
  if (!str(input.sourceUrl)) errors.push("sourceUrl is required (primary source for the facts)");
  else if (!sourceUrl) errors.push("sourceUrl must be an http(s) URL");

  const lastVerified = str(input.lastVerified);
  if (!lastVerified) errors.push("lastVerified is required");
  else if (!validDate(lastVerified)) errors.push("lastVerified must be a valid YYYY-MM-DD date");

  const submissionRaw = input.submissionUrl;
  let submissionUrl: string | null = null;
  if (submissionRaw !== undefined && submissionRaw !== null) {
    submissionUrl = safeHttpUrl(str(submissionRaw));
    if (!submissionUrl) errors.push("submissionUrl must be an http(s) URL when set");
  }

  const kind = oneOf(errors, "kind", input.kind, destinationKindValues);
  const cost = oneOf(errors, "cost", input.cost, destinationCostValues, "unknown");
  const listingMode = oneOf(errors, "listingMode", input.listingMode, destinationListingModeValues, "unknown");
  const submissionsOpen = oneOf(
    errors,
    "submissionsOpen",
    input.submissionsOpen,
    destinationSubmissionsOpenValues,
    "unknown",
  );
  const linkAttr = oneOf(errors, "linkAttr", input.linkAttr, destinationLinkAttrValues, "unknown");
  const aiCited = oneOf(errors, "aiCited", input.aiCited, destinationAiCitedValues, "unknown");
  const aiCitedEvidence = str(input.aiCitedEvidence) || null;
  if (aiCited === "yes" && !aiCitedEvidence) {
    errors.push("aiCited 'yes' requires aiCitedEvidence (query, engine, date)");
  }

  let requirements: Record<string, unknown> = {};
  if (input.requirements !== undefined) {
    if (isRecord(input.requirements)) requirements = input.requirements;
    else errors.push("requirements must be an object");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    row: {
      slug,
      name,
      url: url as string,
      kind,
      audienceTags: tags(errors, "audienceTags", input.audienceTags),
      categoryTags: tags(errors, "categoryTags", input.categoryTags),
      cost,
      priceNote: str(input.priceNote),
      listingMode,
      requirements,
      submissionsOpen,
      submissionUrl,
      linkAttr,
      aiCited,
      aiCitedEvidence,
      sourceUrl: sourceUrl as string,
      lastVerified,
      verifiedBy: str(input.verifiedBy),
      notes: str(input.notes),
    },
  };
}

/** Validate a whole catalog file; returns every error keyed by slug/index so a bad row fails loudly. */
export function validateCatalog(rows: unknown): {
  rows: DestinationInput[];
  errors: { index: number; slug: string; errors: string[] }[];
} {
  if (!Array.isArray(rows)) {
    return { rows: [], errors: [{ index: -1, slug: "", errors: ["catalog must be an array"] }] };
  }
  const out: DestinationInput[] = [];
  const errors: { index: number; slug: string; errors: string[] }[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, index) => {
    const result = validateDestination(raw);
    const slug = isRecord(raw) ? str(raw.slug) : "";
    if (!result.ok) {
      errors.push({ index, slug, errors: result.errors });
      return;
    }
    if (seen.has(result.row.slug)) {
      errors.push({ index, slug, errors: ["duplicate slug"] });
      return;
    }
    seen.add(result.row.slug);
    out.push(result.row);
  });
  return { rows: out, errors };
}
