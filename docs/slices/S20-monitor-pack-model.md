# S20 — Monitor Pack model and auto-draft

**Track:** Radar/Packs (Ideas 2, 4) · **Wave:** 2 · **Size:** M · **Owner:** agent · **Depends on:** none · **Unblocks:** S15, S21, S31, S52

## Outcome
A Monitor Pack is a first-class, versioned object (queries, negative keywords, competitors, communities, sources) that can be drafted automatically from a repo or URL, saved to a workspace, exported as YAML and forked.

## Scope
- **DB:** `monitor_pack(id uuid, slug text unique nullable, owner_workspace_id nullable, visibility text check in ('private','public'), title, description, spec jsonb, version int, forked_from uuid nullable, created_at, updated_at)`; `monitor_pack_version` append-only (same pattern as `monitoring_profile`).
- **Spec (Zod-free, hand validator in `lib/packs/validate.ts`, like `lib/profile/validate.ts`):**
  ```ts
  type PackSpec = { product: {name: string; summary: string; url?: string};
    queries: string[]; negativeKeywords: string[]; competitors: string[];
    communities: {platform: SourcePlatform; name: string}[];
    sources: SourcePlatform[]; notes?: string };
  ```
- **Draft generator:** `lib/packs/draft.ts` `draftPackFromUrl(url)` → fetch README/topics/package file (GitHub API when a GitHub URL, `fetchPublicText`/`retrieveProductMaterial` otherwise, Browser Run `browserMarkdown` (S07) when JS-rendered), then an LLM call through `AI_GATEWAY_API_KEY` that returns a `PackSpec`; deterministic fallback (keywords from README headings/topics) when no key. LLM output is validated; invalid output is rejected, never saved.
- **Apply:** `applyPackToWorkspace(workspaceId, packId)` creates monitoring profile fields + sources within plan limits (S05).
- **API:** `app/api/packs/route.ts` (CRUD for own packs), `app/api/packs/draft/route.ts`.
- **Export:** `packToYaml/yamlToPack` in `lib/packs/yaml.ts` (tiny hand-rolled serializer for this schema to avoid a dependency, or add `yaml` if justified).

## Acceptance criteria
- [ ] Validator tests (limits: 25 queries, 25 negative keywords, 10 competitors, 20 communities; reject URLs/HTML in strings).
- [ ] Draft test with a recorded README fixture and a stubbed LLM; fallback test with no key.
- [ ] Round-trip YAML test.
- [ ] Applying a pack respects plan limits and is idempotent.

## Out of scope
Public library pages (S52), importer (S15), Radar (S21).
