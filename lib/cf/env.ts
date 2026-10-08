/**
 * Typed accessors for optional Cloudflare bindings. Each binding is declared in
 * wrangler.jsonc but absent locally, so every accessor returns null instead of
 * throwing. Shapes are structural (not imported from workers-types) so the
 * module stays usable in tests and outside the Worker runtime.
 */

export type AiBinding = {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
};

export type VectorizeBinding = {
  upsert(vectors: unknown[]): Promise<unknown>;
  query(vector: number[], options?: unknown): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
};

export type SemanticMode = "off" | "shadow" | "on";

function isAiBinding(value: unknown): value is AiBinding {
  return typeof value === "object" && value !== null && "run" in value && typeof value.run === "function";
}

function isVectorizeBinding(value: unknown): value is VectorizeBinding {
  return typeof value === "object" && value !== null && "query" in value && typeof value.query === "function";
}

/** Reads one binding from the Cloudflare request context, or null when unavailable. */
export async function readBinding(name: string): Promise<unknown> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env: unknown = getCloudflareContext().env;
    return typeof env === "object" && env !== null && name in env ? (env as Record<string, unknown>)[name] : undefined;
  } catch (err) {
    // Expected locally (no Cloudflare context). Only the error class is logged:
    // exception text can embed connection details.
    console.warn("[cf/env] binding context unavailable", {
      binding: name,
      error: err instanceof Error ? err.name : "unknown",
    });
    return undefined;
  }
}

/** Workers AI binding (`AI`), or null when not bound. */
export async function getAi(): Promise<AiBinding | null> {
  const binding = await readBinding("AI");
  return isAiBinding(binding) ? binding : null;
}

/** Vectorize index binding (`VECTORIZE`), or null when not bound. */
export async function getVectorize(): Promise<VectorizeBinding | null> {
  const binding = await readBinding("VECTORIZE");
  return isVectorizeBinding(binding) ? binding : null;
}

/** Semantic scoring rollout mode. Anything unrecognised, including unset, is "off". */
export function getSemanticMode(): SemanticMode {
  const raw = process.env.VANTAGE_SEMANTIC_MODE?.trim();
  return raw === "shadow" || raw === "on" ? raw : "off";
}
