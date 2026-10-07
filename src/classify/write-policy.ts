// ---------------------------------------------------------------------------
// Pure write-policy decisions for the signal layer.
//
// These predicates encode the *ordering* rules that the SQL write paths enforce,
// extracted so they can be unit-tested without a live Neon connection. Each
// predicate mirrors exactly one SQL `where` clause in `src/db.ts`; keep the two
// in lockstep (the smoke tests pin the SQL predicate and the pure predicate
// against the same truth table).
// ---------------------------------------------------------------------------

/**
 * The persisted classification state of an item, as far as the write guard cares.
 * `classifiedAt === null` means "never classified"; `version` is the stored
 * `classifier_version` (null when unset).
 */
export interface ExistingClassification {
  readonly classifiedAt: string | null;
  readonly version: string | null;
}

/**
 * Decide whether an incoming classification write may overwrite an existing row.
 *
 * Version-keyed policy (see README): classify new items always; re-classify only
 * on an explicit version bump. Versions are treated as OPAQUE tokens, not a
 * linear order — the re-classify decision is `version is distinct from the
 * stored version`, which is exactly what `is distinct from` computes in SQL.
 * That is sufficient for the version-keyed policy: a deliberate bump changes the
 * string, so the next writer at the new version wins; a same-version writer is
 * a no-op (first-writer-wins).
 *
 * Mirrors SQL: `where i.classified_at is null or i.classifier_version is distinct from v.version`.
 */
export function shouldWriteClassification(
  existing: ExistingClassification,
  newVersion: string,
): boolean {
  if (existing.classifiedAt === null) return true;
  return existing.version !== newVersion;
}
