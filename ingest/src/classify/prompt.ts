// ---------------------------------------------------------------------------
// Classifier prompt construction (pure). No I/O, no db, no env.
//
// Prompt versioning: `CLASSIFIER_PROMPT_VERSION` participates in the stored
// `classifier_version` so that changing the taxonomy or wording can deliberately
// invalidate previously-classified rows and trigger a re-classification.
// ---------------------------------------------------------------------------
import { SIGNAL_LABELS } from "./schema";
import type { ClassificationInputItem } from "./batch";

/**
 * Bump when the prompt text, label set, or output contract changes. Stored per
 * row so a version drift marks rows stale without a schema migration.
 */
export const CLASSIFIER_PROMPT_VERSION = "v1";

/** Human-readable guidance for each label, embedded in the system prompt. */
const LABEL_GUIDE: Readonly<Record<(typeof SIGNAL_LABELS)[number], string>> = {
  launch: "A new product, feature, model, release, or version from a company.",
  complaint: "User pain, dissatisfaction, bugs, outages, or negative experience.",
  feature_request: "Someone asking for a capability that does not exist yet.",
  funding: "Raises, acquisitions, valuations, or financial events.",
  sentiment: "Opinion, praise, or critique of a tool, company, or model.",
  chatter: "Generic discussion with low actionable signal.",
  noise: "Spam, off-topic, or otherwise irrelevant content.",
};

export interface PromptMessages {
  readonly system: string;
  readonly user: string;
}

const SYSTEM_PROMPT = [
  "You are a precise signal classifier for a go-to-market monitor of AI developer tools.",
  "Classify each numbered item with ONE OR MORE labels from this closed set:",
  ...SIGNAL_LABELS.map((label) => `- ${label}: ${LABEL_GUIDE[label]}`),
  "",
  "Rules:",
  "- Return STRICT JSON only. No prose, no markdown fences.",
  '- Shape: {"items":[{"index":<int>,"labels":[...],"entities":[...],"relevance":<0..1>,"reason":"<short>","uncertain":[...]}]}',
  "- Include exactly one result object per input index. `index` MUST match the numbered item.",
  "- `entities` are raw tool/company mentions copied from the text (do not invent).",
  "- `relevance` is 0..1: how relevant the item is to AI developer tools GTM.",
  "- `reason` is one short sentence (<= 200 chars).",
  "- If an item is spam or off-topic, use the `noise` label alone.",
].join("\n");

/** Build the user turn: a compact numbered list, one item per line. */
function buildUserPrompt(items: ReadonlyArray<ClassificationInputItem>): string {
  const lines = items.map((item, position) => {
    const body = item.summary !== null && item.summary !== "" ? item.summary : item.rawContent;
    // Keep per-item context bounded so a single long article cannot dominate the
    // batch prompt (and the bill). Titles are already short.
    const excerpt = body.length > 600 ? `${body.slice(0, 600)}…` : body;
    return [
      `#${position} [${item.sourceName}] ${item.title}`,
      excerpt !== "" ? `    ${excerpt}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n");
  });
  return [
    `Classify these ${items.length} items. Return JSON with one entry per index 0..${items.length - 1}.`,
    "",
    lines.join("\n"),
  ].join("\n");
}

/** Pure: same inputs in, same prompt out. */
export function buildClassificationPrompt(
  items: ReadonlyArray<ClassificationInputItem>,
): PromptMessages {
  return { system: SYSTEM_PROMPT, user: buildUserPrompt(items) };
}

/**
 * Repair prompt: ask only for the missing indices. Reuses the original item
 * context so the model has what it needs without re-sending the whole batch
 * when only a few indices failed.
 */
export function buildRepairPrompt(
  items: ReadonlyArray<ClassificationInputItem>,
  missingIndices: ReadonlyArray<number>,
): PromptMessages {
  const missingSet = new Set(missingIndices);
  const subset = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => missingSet.has(entry.index))
    .map((entry) => entry.item);
  const repairItems = subset.map((item, ordinal) => ({
    ...item,
    // Re-number locally so the model sees a contiguous 0..n-1 list, but keep the
    // original index mapping via the order (caller re-maps with the same order).
    _ordinal: ordinal,
  }));
  const base = buildUserPrompt(repairItems);
  return {
    system: SYSTEM_PROMPT,
    user: [
      "Your previous reply was missing or invalid for some items.",
      "Return STRICT JSON for ONLY these indices, renumbered from 0:",
      base,
    ].join("\n"),
  };
}
