import { DEFAULT_LEAD_THRESHOLD } from "@/lib/pipeline/intent-ladder";

export type PipelineOptionsInput = {
  limit?: unknown;
  threshold?: unknown;
};

export function normalizePipelineOptions(input: PipelineOptionsInput): {
  limit: number;
  threshold: number;
} {
  if (
    input.limit !== undefined &&
    (typeof input.limit !== "number" || !Number.isFinite(input.limit))
  ) {
    throw new Error("limit must be a finite number");
  }
  if (
    input.threshold !== undefined &&
    (typeof input.threshold !== "number" || !Number.isFinite(input.threshold))
  ) {
    throw new Error("threshold must be a finite number");
  }

  const requestedLimit = input.limit ?? 100;
  const requestedThreshold = input.threshold ?? DEFAULT_LEAD_THRESHOLD;
  return {
    limit: Math.min(1000, Math.max(1, Math.trunc(requestedLimit))),
    threshold: Math.min(4, Math.max(0, requestedThreshold)),
  };
}
