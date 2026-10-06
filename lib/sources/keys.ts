import type { SourceType } from "@/lib/collectors/types";

/** Every source type that can carry a global switch. Keep in step with `SourceType`. */
export const SOURCE_SWITCH_KEYS = [
  "hn",
  "rss",
  "substack",
  "reddit",
  "web_search",
  "producthunt",
  "youtube",
  "x",
  "other",
] as const satisfies readonly SourceType[];

export function isSourceSwitchKey(value: unknown): value is SourceType {
  return typeof value === "string" && (SOURCE_SWITCH_KEYS as readonly string[]).includes(value);
}
