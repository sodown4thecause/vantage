// ---------------------------------------------------------------------------
// Signal taxonomy + strict validation of untrusted LLM output.
//
// The inference host returns *text*; it is a boundary, so everything is parsed
// with zod before it can touch internal logic. Illegal states (unknown labels,
// out-of-range relevance, missing indices) are rejected at parse time.
// ---------------------------------------------------------------------------
import { z } from "zod";

/**
 * Closed set of signal labels. A row may carry several (e.g. a launch that is
 * also praised). `noise` is also a routing target: consumers may filter it out.
 */
export const SIGNAL_LABELS = [
  "launch",
  "complaint",
  "feature_request",
  "funding",
  "sentiment",
  "chatter",
  "noise",
] as const;

export type SignalLabel = (typeof SIGNAL_LABELS)[number];

const signallabelSchema = z.enum(SIGNAL_LABELS);

/**
 * The classifier's per-item payload. `index` is the 0-based position in the
 * numbered input batch, used to stitch results back onto items without relying
 * on ordering. `relevance` is clamped to [0,1]; `entities` are raw mentions
 * (canonicalization happens later, deterministically, in `src/entities`).
 */
export const classificationItemSchema = z.object({
  index: z.number().int().nonnegative(),
  labels: z.array(signallabelSchema).min(1).max(SIGNAL_LABELS.length),
  entities: z.array(z.string().trim().min(1).max(120)).max(25).default([]),
  relevance: z.number().min(0).max(1),
  reason: z.string().trim().max(600).default(""),
  /** Optional alternative labels the model was unsure about; advisory only. */
  uncertain: z.array(signallabelSchema).max(SIGNAL_LABELS.length).default([]),
});

export type ClassificationItem = z.infer<typeof classificationItemSchema>;

/**
 * The full classifier reply. Accepts either a bare array or `{ items: [...] }`
 * because JSON-mode providers legitimately wrap arrays in an object.
 */
export const classificationResponseSchema = z.union([
  z.array(classificationItemSchema),
  z.object({ items: z.array(classificationItemSchema) }),
]);

/**
 * Parse an untrusted classifier reply into trusted classifications.
 *
 * Returns a discriminated result rather than throwing: the caller decides
 * whether to repair (re-ask for missing indices) or fall back to `unclassified`.
 * Malformed JSON is a repair trigger, not a crash.
 */
export type ParseOutcome =
  | { readonly ok: true; readonly items: ReadonlyArray<ClassificationItem> }
  | { readonly ok: false; readonly reason: string };

export function parseClassificationResponse(raw: string): ParseOutcome {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: "empty response" };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Some providers fence JSON in ```json ... ``` despite JSON mode. Try one
    // bounded extraction before giving up; still untrusted, still validated.
    const extracted = extractFirstJsonBlock(text);
    if (extracted === null) return { ok: false, reason: "response was not valid JSON" };
    try {
      json = JSON.parse(extracted);
    } catch {
      return { ok: false, reason: "response was not valid JSON" };
    }
  }

  const parsed = classificationResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "schema validation failed" };
  }
  const items = Array.isArray(parsed.data) ? parsed.data : parsed.data.items;
  return { ok: true, items };
}

/** Pull the first balanced `[...]` or `{...}` block out of fenced/annotated text. */
function extractFirstJsonBlock(text: string): string | null {
  const startArray = text.indexOf("[");
  const startObject = text.indexOf("{");
  const starts = [startArray, startObject].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1);
}
