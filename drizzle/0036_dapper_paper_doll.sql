ALTER TABLE "content_draft" ADD COLUMN "source_citations" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
-- Recover only exact same-workspace document URLs. Legacy DataForSEO citations had no separate provenance and remain untrusted.
UPDATE "content_draft" AS draft
SET "source_citations" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'title', COALESCE(verified.title, 'Workspace source'),
    'url', verified.url
  ) ORDER BY verified.url)
  FROM (
    SELECT candidates.url, min(NULLIF(doc.title, '')) AS title
    FROM (
      SELECT DISTINCT (matches.captures)[1] AS url
      FROM regexp_matches(
        draft.body,
        '^[[:blank:]]*-[[:blank:]]*(https?://[^[:space:]<>]+)[[:blank:]]*\r?$',
        'gmi'
      ) AS matches(captures)
    ) AS candidates
    INNER JOIN "document" AS doc
      ON doc.workspace_id = draft.workspace_id
     AND doc.url_canonical = candidates.url
    GROUP BY candidates.url
  ) AS verified
), '[]'::jsonb)
WHERE draft.body ~* 'Sources:'
  AND draft.source_citations = '[]'::jsonb;