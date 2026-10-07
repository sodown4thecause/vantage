// ---------------------------------------------------------------------------
// Pure write-policy decisions for the signal layer.
//
// These predicates are a SPECIFICATION and REGRESSION PIN, not the executed code
// path. The production decision is made by SQL in `src/db.ts`
// (`saveClassifications`); the predicate here encodes the same rule in TypeScript
// so its truth table can be pinned by the smoke tests without a live Neon
// connection. The two can therefore DRIFT: the tests below give confidence in the
// INTENDED policy, but they do not exercise the SQL. The executed SQL predicate is
// covered only by integration tests against a real database.
//
// Keep this in lockstep with the `where` clause named on each predicate. If the
// SQL changes, update both the predicate and its tests.
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
 *
 * NOTE: this function is a SPECIFICATION/regression pin, not the executed code
 * path (see module header). The SQL in `saveClassifications` is the real guard
 * and is covered only by integration tests.
 */
export function shouldWriteClassification(
  existing: ExistingClassification,
  newVersion: string,
): boolean {
  if (existing.classifiedAt === null) return true;
  return existing.version !== newVersion;
}

/**
 * Decide whether a row needs to be LOADED for classification at `currentVersion`.
 *
 * This is the load-side complement of `shouldWriteClassification`: a row is
 * selected when it has never been classified OR its stored version is stale
 * relative to the current version. Because a written classification stamps the
 * incoming version, the stale set converges after one pass — a just-bumped row
 * stops matching on the next load.
 *
 * Like `shouldWriteClassification`, this is a SPECIFICATION/regression pin, not
 * the executed code path. It mirrors the LOAD `where` clause in
 * `saveClassifications`'s counterpart `loadUnclassifiedItems` (src/db.ts):
 *   `where i.classified_at is null or i.classifier_version is distinct from <version>`
 */
export function shouldLoadForClassification(
  existing: ExistingClassification,
  currentVersion: string,
): boolean {
  if (existing.classifiedAt === null) return true;
  return existing.version !== currentVersion;
}
