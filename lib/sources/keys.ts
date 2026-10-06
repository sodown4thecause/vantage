import type { SourceType } from "@/lib/collectors/types";

/** Every collector source type that can carry a global switch. Keep in step with `SourceType`. */
const SOURCE_TYPE_KEYS = [
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

/** Switches that are not collector types but still need an operator control. */
const EXTRA_SWITCH_KEYS = ["browser_run"] as const;

export const SOURCE_SWITCH_KEYS = [...SOURCE_TYPE_KEYS, ...EXTRA_SWITCH_KEYS] as const;

export type SourceSwitchKey = (typeof SOURCE_SWITCH_KEYS)[number];

export function isSourceSwitchKey(value: unknown): value is SourceSwitchKey {
  return typeof value === "string" && (SOURCE_SWITCH_KEYS as readonly string[]).includes(value);
}
