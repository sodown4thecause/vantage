import { z } from "zod";

/*
 * The profile draft derived from the owner's website. Pure and dependency-free, so the interview state and the
 * client can use it without loading the AI SDK. A draft is only a suggestion until the owner confirms each field.
 */

export const PROFILE_FIELDS = ["productDescription", "targetCustomer", "competitors", "communities", "keywords"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const FIELD_LABELS: Record<ProfileField, string> = {
  productDescription: "Product description",
  targetCustomer: "Ideal customer",
  competitors: "Competitors",
  communities: "Communities",
  keywords: "Keywords",
};

const listOf = (min: number, max: number, itemMax: number) => z.array(z.string()).transform((items) => {
  const out: string[] = [];
  for (const item of items) {
    const value = item.trim().replace(/\s+/g, " ");
    if (value && value.length <= itemMax && !out.some((existing) => existing.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out.slice(0, max);
}).pipe(z.array(z.string()).min(min));

/** A field the model got wrong is dropped, so the owner fills that one in instead of losing the whole draft. */
const fieldSchemas = {
  productDescription: z.string().trim().min(10).max(1000),
  targetCustomer: z.string().trim().min(3).max(1000),
  competitors: listOf(3, 5, 200),
  communities: listOf(0, 10, 100),
  keywords: listOf(1, 12, 100),
} as const;

export const profileDraftSchema = z.object({
  productDescription: z.string().max(1000).optional(),
  targetCustomer: z.string().max(1000).optional(),
  competitors: z.array(z.string().max(200)).max(5).optional(),
  communities: z.array(z.string().max(100)).max(10).optional(),
  keywords: z.array(z.string().max(100)).max(12).optional(),
});
export type ProfileDraft = z.infer<typeof profileDraftSchema>;

/** Keeps each derived field that validates and drops the rest. */
export function normaliseDraft(raw: unknown): ProfileDraft {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const draft: ProfileDraft = {};
  for (const key of PROFILE_FIELDS) {
    const parsed = fieldSchemas[key].safeParse(record[key]);
    if (parsed.success) (draft as Record<string, unknown>)[key] = parsed.data;
  }
  return draft;
}

/** A draft value as the editable text the card shows: lists are comma separated. */
export function draftText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}
