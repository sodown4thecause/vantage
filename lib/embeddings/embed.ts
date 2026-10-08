import { getAi } from "@/lib/cf/env";
import { recordCost } from "@/lib/costs/ledger";
import { getUnitCost } from "@/lib/costs/prices";

export const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
export const EMBEDDING_DIMENSIONS = 1024;

const BATCH_SIZE = 64;
const MAX_CHARS = 6000;

export type EmbedContext = { workspaceId?: string; sourceKey: string; signal?: AbortSignal };

function isEmbeddingResponse(value: unknown): value is { data: unknown[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { data?: unknown }).data);
}

function isValidVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EMBEDDING_DIMENSIONS &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * Embed texts with Workers AI. Output is index-aligned with the input; blank
 * texts are not sent and yield `[]`. Returns null (never throws) when the AI
 * binding is absent, the call fails, or any vector has the wrong dimension, so
 * callers can fall back to keyword-only scoring.
 */
export async function embedTexts(texts: string[], ctx: EmbedContext): Promise<number[][] | null> {
  try {
    const ai = await getAi();
    if (!ai) return null;

    const out: number[][] = texts.map(() => []);
    const pending: Array<{ index: number; text: string }> = [];
    texts.forEach((text, index) => {
      if (text.trim() === "") return;
      pending.push({ index, text: text.slice(0, MAX_CHARS) });
    });

    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      if (ctx.signal?.aborted) return null;
      const batch = pending.slice(start, start + BATCH_SIZE);
      const inputs = batch.map((item) => item.text);
      const tokens = inputs.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);

      let vectors: unknown[];
      try {
        const response = await ai.run(EMBEDDING_MODEL, { text: inputs }, { gateway: { id: "vantage" } });
        if (!isEmbeddingResponse(response) || response.data.length !== inputs.length) {
          await recordEmbedCost(ctx, tokens, false);
          return null;
        }
        vectors = response.data;
      } catch (err) {
        console.error("[embed] embedding call failed", {
          error: err instanceof Error ? err.name : "unknown",
        });
        await recordEmbedCost(ctx, tokens, false);
        return null;
      }

      if (!vectors.every(isValidVector)) {
        await recordEmbedCost(ctx, tokens, false);
        return null;
      }
      batch.forEach((item, i) => {
        out[item.index] = vectors[i] as number[];
      });
      await recordEmbedCost(ctx, tokens, true);
    }
    return out;
  } catch (err) {
    console.error("[embed] unexpected embedding failure", {
      error: err instanceof Error ? err.name : "unknown",
    });
    return null;
  }
}

/** One ledger row per run call; units are millions of estimated input tokens. */
async function recordEmbedCost(ctx: EmbedContext, tokens: number, ok: boolean): Promise<void> {
  try {
    const unitCostUsd = await getUnitCost("workers_ai", "embed_m_tokens");
    await recordCost({
      sourceKey: ctx.sourceKey,
      provider: "workers_ai",
      action: "embed_m_tokens",
      workspaceId: ctx.workspaceId,
      units: tokens / 1_000_000,
      unitCostUsd,
      ok,
    });
  } catch (err) {
    console.error("[embed] cost metering failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
