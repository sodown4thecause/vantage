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
  /**
   * Conditional-GET / pagination state to write back onto `source`.
   * Omitted properties and explicit `undefined` preserve the stored value;
   * explicit `null` clears it. A conditional HTTP 304 returns no documents and
   * echoes the current etag / lastModified validators here.
   */
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

export type SourceType =
  | "hn"
  | "rss"
  | "substack"
  | "reddit"
  | "web_search"
  | "producthunt"
  | "youtube"
  | "other";
