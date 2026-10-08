import { readBinding } from "@/lib/cf/env";

/**
 * Messages on the `vantage-embed-jobs` queue. IDs only: the consumer re-reads the rows, and the
 * message must stay far below the 128 KB queue limit.
 */
export type EmbedJob =
  | { type: "index-profile"; workspaceId: string; profileId: string }
  | { type: "backfill-documents"; workspaceId: string };

export type QueueBinding = {
  send(message: unknown, options?: unknown): Promise<unknown>;
};

function isQueueBinding(value: unknown): value is QueueBinding {
  return typeof value === "object" && value !== null && "send" in value && typeof value.send === "function";
}

/** Producer binding `EMBED_QUEUE`, or null when not bound (local development, tests). */
export async function getEmbedQueue(): Promise<QueueBinding | null> {
  const binding = await readBinding("EMBED_QUEUE");
  return isQueueBinding(binding) ? binding : null;
}

/**
 * Best-effort enqueue. Resolves true only when the queue accepted the message. Resolves false when
 * the binding is absent or `send` fails, so callers can fall back to indexing directly. Never throws.
 */
export async function enqueueEmbedJob(message: EmbedJob): Promise<boolean> {
  try {
    const queue = await getEmbedQueue();
    if (!queue) return false;
    await queue.send(message);
    return true;
  } catch (err) {
    // Only the error class is logged: exception text can embed connection details.
    console.warn("[cf/queue] embed job not enqueued", {
      type: message.type,
      error: err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}
