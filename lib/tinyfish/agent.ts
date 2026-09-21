import type { AgentRunParams, TinyFish } from "@tiny-fish/sdk";

import { createTinyFishClient } from "@/lib/tinyfish/client";

export type TinyFishStructuredRunOptions = {
  url: string;
  goal: string;
  outputSchema: Record<string, unknown>;
  browserProfile?: "lite" | "stealth";
  maxSteps?: number;
  maxDurationSeconds?: number;
  client?: TinyFish;
};

/**
 * Run a TinyFish web agent and return its structured `result` object.
 * Throws when the run fails or returns no usable result payload.
 */
export async function runTinyFishStructuredAgent(
  opts: TinyFishStructuredRunOptions,
): Promise<Record<string, unknown>> {
  const client = opts.client ?? createTinyFishClient();
  const params: AgentRunParams = {
    url: opts.url,
    goal: opts.goal,
    browser_profile: opts.browserProfile ?? "lite",
    output_schema: opts.outputSchema,
    agent_config: {
      mode: "strict",
      max_steps: opts.maxSteps ?? 40,
      max_duration_seconds: opts.maxDurationSeconds ?? 180,
    },
  };

  const response = await client.agent.run(params);
  if (response.status !== "COMPLETED" || response.error) {
    const message =
      response.error?.message ??
      `TinyFish agent run ended with status ${response.status}`;
    throw new Error(message);
  }

  const result = normalizeAgentResult(response.result);
  if (!result) {
    throw new Error("TinyFish agent returned an empty result");
  }
  return result;
}

/** Coerce SDK result payloads (object or JSON string) into a plain object. */
export function normalizeAgentResult(
  result: unknown,
): Record<string, unknown> | null {
  if (result == null) return null;
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (!trimmed) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { text: trimmed };
    }
  }
  if (typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { value: result };
}

export function asRecordArray(
  value: unknown,
  keys: string[] = [],
): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(obj[key])) {
        return asRecordArray(obj[key]);
      }
    }
  }
  return [];
}

export function stringField(
  row: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

export function numberField(
  row: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}
