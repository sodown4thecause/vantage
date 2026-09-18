import type { NewDocument } from "@/lib/db/schema";

/**
 * Shared contract for free-lane collectors (HN, RSS, Substack, …).
 * Each collector is responsible for:
 * - reading its `source` row config / cursor / etag
 * - fetching upstream content
 * - returning normalized document inserts (caller persists)
 */
export type CollectorContext = {
  workspaceId: string;
  sourceId: string;
  /** Opaque source.config jsonb from the DB. */
  config: Record<string, unknown>;
  etag?: string | null;
  lastModified?: string | null;
  cursor?: string | null;
};

export type CollectorResult = {
  documents: NewDocument[];
  /** Updated conditional-GET / pagination state to write back onto `source`. */
  nextState?: {
    etag?: string | null;
    lastModified?: string | null;
    cursor?: string | null;
  };
};

export interface Collector {
  readonly name: string;
  run(ctx: CollectorContext): Promise<CollectorResult>;
}
