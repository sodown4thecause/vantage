/*
 * Shared by the DataForSEO wrappers. Provider payloads are untrusted: every helper copies only typed primitives
 * and falls back to a neutral value, so no provider object reaches the cache or the UI.
 */

/** One DataForSEO task as a builder returns it: the endpoint, the task body and the estimated cost in USD. */
export type DataForSeoCall = { endpoint: string; task: Record<string, unknown>; estimateUsd: number };

/** Defaults for every task that does not say otherwise. */
export const SEO_DEFAULTS = { location_code: 2840, language_code: "en" } as const;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The value as a record, or an empty record. */
export const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/** The array's record elements; anything else is dropped. */
export const recordsOf = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

/** A finite number, or 0. */
export const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** A finite number, or null. */
export const numOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The value when it is a string, else null. */
export const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The records of `result[0].items`, or none. */
export const itemsOf = (result: unknown[]): Record<string, unknown>[] => recordsOf(recordOf(result[0]).items);
