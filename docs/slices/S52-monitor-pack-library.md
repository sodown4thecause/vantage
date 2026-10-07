# S52 — Public Monitor Pack library and CI validation

**Track:** Ship as a skill (Idea 4) · **Wave:** 3 · **Size:** M · **Owner:** agent · **Depends on:** S20 · **Unblocks:** S51

## Outcome
Each niche (vector databases, AI agents, observability, DevOps, self-hosted analytics, …) has a public pack page showing what it watches, recent public threads, contributors and a fork button; new packs arrive as pull requests.

## Scope
- Repo directory `packs/<slug>.yaml` using the S20 schema (+ `title`, `description`, `tags`, `contributors`); seed 10 packs.
- CI check (`scripts/validate-packs.ts`, run in `pnpm test` and as a step of the GitHub Actions workflow `.github/workflows/ci.yml`): schema validation, duplicate slugs, banned content (URLs shortener list, promotional claims), limits.
- Sync job: on deploy (or `pnpm packs:sync`) upserts public packs into `monitor_pack` (visibility `public`, slug unique).
- Pages: `/packs` (grid, tags, search), `/packs/[slug]` (spec, recent public threads from `shared_post`/Radar-style scan, contributors from git history if available at build time, "Use this pack" → S23 flow, "Fork" → creates a private copy). Each pack page is an SEO landing page ("Find people looking for a vector database").
- `CONTRIBUTING-PACKS.md`.

## Acceptance criteria
- [ ] Validation fails CI on a malformed pack (demonstrate) and passes on all seeds.
- [ ] Pack page renders with and without recent threads.
- [ ] Fork creates an editable private pack within plan limits.
