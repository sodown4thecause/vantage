/**
 * The edit pass on the /tour page: a draft with AI tells, each one marked and then replaced as the
 * reader scrolls. Pure data and arithmetic so the page and its tests share one source.
 */

export type DraftPiece =
  | { kind: "text"; text: string }
  | { kind: "edit"; before: string; after: string; rule: string };

export type EditState = "open" | "marked" | "fixed";

export const DRAFT: readonly DraftPiece[] = [
  { kind: "edit", before: "In today's fast-paced AI landscape, agent loops", after: "Agent loops", rule: "Stock opener" },
  { kind: "text", text: " " },
  {
    kind: "edit",
    before: "are more than just a bug — they're a silent budget killer.",
    after: "burn tokens without raising an error.",
    rule: "Not-X-but-Y contrast, with an em dash",
  },
  { kind: "text", text: " When a tool call fails, " },
  {
    kind: "edit",
    before: "the agent embarks on a journey of retries that nobody sees.",
    after: "the agent retries and nobody sees it.",
    rule: "Inflated phrasing",
  },
  { kind: "text", text: " " },
  {
    kind: "edit",
    before: "Moreover, leveraging a trace of every call can seamlessly unlock the root cause in minutes.",
    after: "A trace of every call shows which one failed first.",
    rule: "Stock transition, buzzwords and a claim nobody measured",
  },
  { kind: "text", text: " " },
  {
    kind: "edit",
    before: "It's not about logging more; it's about seeing the whole tree.",
    after: "Log less, and keep the parent of every call.",
    rule: "Slogan closer",
  },
];

export const EDIT_COUNT = DRAFT.filter((p) => p.kind === "edit").length;

/** Each edit takes two steps: marked, then fixed. Step 0 is the untouched draft. */
export const LAST_STEP = EDIT_COUNT * 2;

/** Maps act progress (0..1) to a step, leaving a short lead-in and a hold on the finished draft. */
export function stepForProgress(p: number, from = 0.1, to = 0.84): number {
  if (!Number.isFinite(p)) return 0;
  const t = Math.min(1, Math.max(0, (p - from) / (to - from)));
  return Math.min(LAST_STEP, Math.floor(t * LAST_STEP + 1e-9));
}

/** State of the edit at `index` (0-based among edits) at `step`. */
export function editState(index: number, step: number): EditState {
  if (step >= index * 2 + 2) return "fixed";
  if (step >= index * 2 + 1) return "marked";
  return "open";
}

/** The draft as plain text at `step`: fixed edits read their replacement, the rest their original. */
export function draftText(step: number): string {
  let i = 0;
  return DRAFT.map((piece) => {
    if (piece.kind === "text") return piece.text;
    return editState(i++, step) === "fixed" ? piece.after : piece.before;
  }).join("");
}
