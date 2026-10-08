import { readBinding } from "@/lib/cf/env";

/**
 * The only module allowed to touch the ARTIFACTS R2 binding. Keys are built
 * from validated segments so a caller-supplied id cannot traverse out of its
 * workspace prefix.
 */

export type ArtifactKind = "screenshot" | "snapshot";
const KINDS: readonly string[] = ["screenshot", "snapshot"];

/** A UUID, or a conservative slug. Dots and slashes are excluded, so no segment can traverse. */
const SAFE_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9][A-Za-z0-9_-]{0,63})$/i;

export type ArtifactBucket = {
  put(
    key: string,
    value: ArrayBuffer | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
};

function isArtifactBucket(value: unknown): value is ArtifactBucket {
  return typeof value === "object" && value !== null && "put" in value && typeof value.put === "function";
}

function assertSegment(name: string, value: string): void {
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) {
    throw new RangeError(`${name} must be a UUID or a safe slug`);
  }
}

/** Object key for a workspace-scoped artifact: `${workspaceId}/${kind}/${id}`. Throws RangeError on unsafe input. */
export function artifactKey(workspaceId: string, kind: ArtifactKind, id: string): string {
  assertSegment("workspaceId", workspaceId);
  if (!KINDS.includes(kind)) throw new RangeError("kind must be screenshot or snapshot");
  assertSegment("id", id);
  return `${workspaceId}/${kind}/${id}`;
}

function assertArtifactKey(key: string): void {
  const parts = typeof key === "string" ? key.split("/") : [];
  if (parts.length !== 3) throw new RangeError("artifact key must have three segments");
  const [workspaceId = "", kind = "", id = ""] = parts;
  assertSegment("workspaceId", workspaceId);
  if (!KINDS.includes(kind)) throw new RangeError("kind must be screenshot or snapshot");
  assertSegment("id", id);
}

/**
 * Stores an object and returns its key, or null when ARTIFACTS is not bound or
 * the put fails. Never throws: artifacts are best-effort and must not fail the
 * operation that produced them.
 */
export async function putArtifact(
  key: string,
  body: ArrayBuffer | string,
  contentType: string,
): Promise<string | null> {
  try {
    assertArtifactKey(key);
    const bucket = await readBinding("ARTIFACTS");
    if (!isArtifactBucket(bucket)) return null;
    await bucket.put(key, body, { httpMetadata: { contentType } });
    return key;
  } catch (err) {
    // Only the error class is logged: exception text can embed bucket details.
    console.error("[r2/artifacts] put failed", { error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}
