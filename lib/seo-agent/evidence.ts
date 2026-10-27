import { boundJsonSize, filterToolEvidence, projectToolFields } from "@/lib/dataforseo/field-filter";
import type { PlannedCall } from "@/lib/seo-agent/conversations";
import type { DataSource } from "@/lib/seo-agent/tools/shared";

export const MODEL_CONTEXT_LIMIT = 12_000;
export const EVIDENCE_ITEM_JSON_LIMIT = 12_000;
export const EVIDENCE_TOTAL_JSON_LIMIT = 48_000;
const EVIDENCE_INPUT_JSON_LIMIT = 1_000;

const UNSUPPORTED_NOTICE = "Some research output could not be included safely.";

export type EvidenceEntry = {
  tool: string;
  source: DataSource;
  /** The lookup this result answers, when the tool recorded one (for example the searched phrase). */
  input?: unknown;
  data: unknown;
  truncated: boolean;
};

export type EvidencePacket = {
  question: string;
  conversationContext: string;
  profile: unknown;
  entries: EvidenceEntry[];
  notices: string[];
  pendingApprovals: PlannedCall[];
};

export type EvidenceResultInput = {
  tool: string;
  source: DataSource;
  value: unknown;
  input?: Record<string, unknown>;
};

function clipText(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function uniqueNotices(notices: string[]): string[] {
  const out: string[] = [];
  for (const notice of notices) {
    if (!out.includes(notice)) out.push(notice);
  }
  return out;
}

/** Assemble summarizer-ready evidence from already-fetched tool values. */
export function buildEvidencePacket(input: {
  question: string;
  conversationContext: string;
  profile: unknown;
  results: EvidenceResultInput[];
  notices: string[];
  pendingApprovals: PlannedCall[];
}): EvidencePacket {
  const notices = uniqueNotices([...input.notices]);
  const entries: EvidenceEntry[] = [];

  for (const result of input.results) {
    const projected = projectToolFields(result.tool, result.value);
    if ("unsupported" in projected) {
      if (!notices.includes(UNSUPPORTED_NOTICE)) notices.push(UNSUPPORTED_NOTICE);
      continue;
    }
    if ("control" in projected) continue;
    const data = filterToolEvidence(result.tool, result.value);
    const truncated = projected.truncated
      || (data !== null && typeof data === "object" && !Array.isArray(data) && (data as { truncated?: boolean }).truncated === true);
    const input = result.input ? boundJsonSize(result.input, EVIDENCE_INPUT_JSON_LIMIT) : undefined;
    const envelope = { tool: result.tool, source: result.source, ...(input === undefined ? {} : { input }), truncated };
    // The whole entry, not just its data, stays inside the per-item limit.
    const room = EVIDENCE_ITEM_JSON_LIMIT - JSON.stringify({ ...envelope, data: null }).length + 4;
    entries.push({
      tool: result.tool,
      source: result.source,
      ...(input === undefined ? {} : { input }),
      data: boundJsonSize(data, room),
      truncated,
    });
  }

  let packed = entries;
  while (JSON.stringify(packed).length > EVIDENCE_TOTAL_JSON_LIMIT && packed.length > 0) {
    packed = packed.slice(0, -1);
    if (!notices.includes(UNSUPPORTED_NOTICE)) notices.push(UNSUPPORTED_NOTICE);
  }

  return {
    question: clipText(input.question, MODEL_CONTEXT_LIMIT),
    conversationContext: clipText(input.conversationContext, MODEL_CONTEXT_LIMIT),
    profile: boundJsonSize(input.profile, MODEL_CONTEXT_LIMIT),
    entries: packed,
    notices,
    pendingApprovals: input.pendingApprovals,
  };
}
