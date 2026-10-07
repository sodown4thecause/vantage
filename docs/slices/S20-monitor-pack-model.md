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
- **Draft generator:** `lib/packs/draft.ts` `draftPackFromUrl(url)` → fetch README/topics/package file (GitHub API when a GitHub URL, `fetchPublicText`/`retrieveProductMaterial` otherwise, Browser Run `browserMarkdown` (S07) when JS-rendered), then an LLM call through `AI_GATEWAY_API_KEY` that returns a `PackSpec`. Every metered provider call (GitHub API, Browser Run, the LLM) goes through `withCost` / `recordCost` and its `getSourceSwitch(sourceKey)` check (use a `source_switch` key such as `ai_gateway` for the LLM, seeded on) and a paused source returns a labelled state; check the AI budget (the public daily budget when called from S21/public routes via S06, the workspace allowance otherwise) before the LLM call and skip to the deterministic fallback when over budget; accept an optional pre-fetched `material` argument so S21 does not fetch the same page twice. Deterministic fallback (keywords from README headings/topics) when no key. LLM output is validated; invalid output is rejected, never saved.
- **Apply:** `applyPackToWorkspace(workspaceId, packId)` creates monitoring profile fields + sources within plan limits (S05). The profile save path hard-caps `topics` at `MAX_TOPICS = 12` in `lib/profile/validate.ts`, below the Pro `keywords` limit (25) and the pack query limit (25): raise `MAX_TOPICS` to 25 in this slice so the plan limit (`assertWithinCount`, free 5 / pro 25) is the effective cap, and keep its test updated. Applying a pack with more queries than the plan allows fails with the plan-limit message, never silently truncates.
- **API:** `app/api/packs/route.ts` (CRUD for own packs), `app/api/packs/draft/route.ts`.
- **Export:** `packToYaml/yamlToPack` in `lib/packs/yaml.ts` (tiny hand-rolled serializer for this schema to avoid a dependency, or add `yaml` if justified).

## Acceptance criteria
- [ ] Validator tests (limits: 25 queries, 25 negative keywords, 10 competitors, 20 communities; reject URLs/HTML in strings).
- [ ] Draft test with a recorded README fixture and a stubbed LLM; fallback test with no key.
- [ ] Metering test: each provider call writes a `cost_event`; a paused source returns the labelled state with no call; an over-budget AI check uses the deterministic fallback.
- [ ] A 25-query pack applies on Pro (profile validator allows it) and is rejected on Free with the plan-limit message.
- [ ] Round-trip YAML test.
- [ ] Applying a pack respects plan limits and is idempotent.

## Out of scope
Public library pages (S52), importer (S15), Radar (S21).
