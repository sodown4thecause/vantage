# Community GTM phase validation

Validated on 7 October 2026 in the isolated `codex/community-gtm-phase` worktree, based on `a221c021f3faff060e271a3e6ae39ece6902833b`.

## Application checks

| Check | Result |
| --- | --- |
| TypeScript (`tsc --noEmit`) | Pass |
| ESLint (`npm run lint`) | Pass |
| Vitest (`vitest run --maxWorkers=1`) | 406 tests in 56 files pass |
| Scheduled Worker wrapper (`node --test test/worker-entry.test.mjs`) | 5 tests pass |
| Migration generation (`drizzle-kit generate`) | No schema changes; migration and metadata match the checkout |
| Next production build (`npm run build`) | Pass |
| Independent branch review | No remaining blocking findings |

Checks use Node 24 in Ubuntu WSL. Tests mock paid provider calls. The build uses non-secret CI placeholders, and the Linux source mirror was compared with the changed application, test and migration files before validation.

Review fixes have regression coverage: edits cannot extend a cited claim with unsupported facts; advice exemptions match whole words; ambiguous cost writes retain a durable reservation token; concurrent source additions share the workspace lease and reserve the onboarding source slot; Reddit previews remain discovery evidence; quoted research briefs can be copied without being treated as proposed comment claims.

## Provider evidence and activation

The separate [provider receipts](2026-10-07-provider-verification.json) record current model IDs, rates, Alexandria contracts and samples, primary contribution rules, and a TinyFish connector sample. The [source runbook](../sources/community-collection.md) records verified public feeds. These checks do not prove authenticated application access to those providers.

- Apply migration `0016_community_gtm_phase.sql` through the existing staging acceptance process before enabling this code against a database.
- Install selected catalog entries in source settings; existing workspace source limits apply. Public feeds and official GitHub/Stack Overflow endpoints remain in the free scheduled lane.
- Supply application provider keys through the existing secret mechanism. Paid calls additionally require `VANTAGE_PAID_PROVIDERS_ENABLED=true` and a positive `VANTAGE_PAID_DAILY_BUDGET_USD`. Alexandria also requires an explicit `FIRECRAWL_CREDIT_USD` conversion.
- Sol is the default manual draft model. Inco DeepSeek triage and Grok significance review are separately opt-in. Native X retrieval through AI Gateway is unverified; the implemented experiment reviews Scavio-acquired posts.
- HN and Stack Overflow remain research-only. Unknown communities require human rules review, and proposed drafts require evidence review before copy handoff.

No database migration, deployment, schedule activation, social publication or DM was performed. Cloudflare packaging and upload dry-run results will be checked in the pull request's CI before merge.
