# Community GTM phase validation

Validated on 7 October 2026 in the isolated `codex/community-gtm-phase` worktree, based on `a221c021f3faff060e271a3e6ae39ece6902833b`.

## Application checks

| Check | Result |
| --- | --- |
| TypeScript (`tsc --noEmit`) | Pass |
| ESLint (`eslint`) | Full review checkout passes |
| Vitest (`vitest run --maxWorkers=1`) | Review run: 453 tests in 57 files pass; subsequent focused checks pass 43 draft tests and 19 developer-collector tests |
| Scheduled Worker wrapper (`node --test test/worker-entry.test.mjs`) | 5 tests pass |
| Migration generation (`drizzle-kit generate`) | No schema changes; migration and metadata match the checkout |
| Next production build (`pnpm run build`) | Initial phase and first PR head pass, including the supplied Cloudflare build log |
| Cloudflare bundle and staging upload dry run | PR head `96c9f8b` passes both GitHub CI jobs, with 489 application tests and five Worker tests, and the actual branch-preview upload; subsequent heads are checked again before merge |
| Independent branch review | Findings addressed with regression coverage; final PR review is required before merge |

The second review's focused run passes 73 tests across source actions, community providers and developer APIs. It reproduces and fixes changed-query cursors, shifting activity pages, malformed external response fields and final-page dataset truncation. Direct Server Actions preserve progressive enhancement. A read-only call to the installed Wrangler configuration reader confirms that the top-level build hook remains enabled and both named environment overrides suppress it; CI records one OpenNext build and no repeated custom build for the named staging dry run.

The third review's focused checks pass 130 tests across four files after reproducing the reported failures; TypeScript and targeted lint also pass, and all nine changed code/test files match the Linux validation mirror. Authenticated draft GET requests accept an optional target UUID; the repository retrieves the newest exact target in the workspace and opportunity before falling back to a legacy row with no quality metadata. Selecting a previous conversation therefore reloads its matching saved draft. Legacy text stays visible with an explicit unknown-conversation label, and remains blocked from approval and copy handoff until regeneration. Indexed LinkedIn responses are narrowed at runtime, malformed JSON errors are sanitized, and valid returned credits remain accountable when result validation rejects. Stack Overflow tests reproduce delayed-visible activity crossing a saved boundary: a 60-second settlement margin and 300-second completed-window overlap recover the covered cases without adding API requests. These operational margins do not promise a consistent snapshot or complete coverage beyond the bounded overlap.

PR head `ef915e3` passes all 532 application tests in 57 files and five Worker tests, both GitHub CI jobs, and the actual Cloudflare branch-preview upload. The fourth review reproduces and fixes retrieval-outcome accounting: 55 focused tests pass, including known zero and positive failure costs, failed ledger writes and missing settlement rows. TypeScript, targeted lint, the source/migration mirror comparison and a repeat migration generation with no schema drift also pass. Unusable LinkedIn responses record failed attempts with their reported costs before errors propagate. Migration `0017_community_draft_lookup.sql` adds a workspace/opportunity/target/creation-time expression index and a workspace/opportunity/creation-time index for legacy and global lookup. The migration is generated with its matching snapshot and journal; it is not applied to a database.

PR head `97450d7` passes all 537 application tests, five Worker tests, both GitHub CI jobs and the actual Cloudflare preview upload. The fifth review removes unchecked response assertions from Grok parsing and the equivalent Alexandria envelope parser. Both parse JSON as unknown and narrow objects and record arrays before use. Regression tests reproduce provider-body fragments in malformed Alexandria JSON errors, which now return a fixed sanitized message. The 59 focused Gateway/community-provider tests, TypeScript and targeted lint pass, and the changed files match the Linux validation mirror. Grok still preserves literal acquired posts, rejects invented URLs or invalid scores, and records known usage before interpreting its model output.

Review checks use Node 22 in Ubuntu WSL, matching GitHub CI. The supplied Cloudflare log uses Node 24. Tests mock paid provider calls. Builds use non-secret CI placeholders, and the Linux source mirror is compared with changed application, test and migration files before validation.

Review fixes have regression coverage: every complete proposed sentence needs a claim ledger entry, including advice and questions; abbreviations preserve sentence boundaries; malformed stored quality cannot bypass approval; approval checks the exact reviewed edit; unknown API failures cannot expose database messages; rate-limited collection preserves accepted evidence and resumable progress; incomplete empty results remain partial; ambiguous cost writes retain a durable reservation token; concurrent source additions share the workspace lease and reserve the onboarding source slot; source changes invalidate stale drafts and async responses. Quoted research briefs remain distinct from proposed comments.

The supplied preview log confirms that Next compiled successfully before `wrangler preview` rejected a missing `previews` block. PR head `9ea53eb` subsequently passed the Cloudflare branch-preview build. The top-level custom `cf:build` hook supports raw dashboard preview commands; named staging and production configurations suppress it with an empty command because their CI workflows already build OpenNext explicitly. Installed Wrangler source confirms the environment overrides take precedence and skip the custom hook. Successful preview upload does not confirm configured runtime authentication or isolated test secrets.

## Provider evidence and activation

The separate [provider receipts](2026-10-07-provider-verification.json) record current model IDs, rates, Alexandria contracts and samples, primary contribution rules, and a TinyFish connector sample. The [source runbook](../sources/community-collection.md) records verified public feeds. These checks do not prove authenticated application access to those providers.

- Apply pending migrations `0016_community_gtm_phase.sql` and `0017_community_draft_lookup.sql` through the existing staging acceptance process before enabling this code against a database.
- Install selected catalog entries in source settings; existing workspace source limits apply. Public feeds and official GitHub/Stack Overflow endpoints remain in the free scheduled lane.
- Supply application provider keys through the existing secret mechanism. Paid calls additionally require `VANTAGE_PAID_PROVIDERS_ENABLED=true` and a positive `VANTAGE_PAID_DAILY_BUDGET_USD`. Alexandria also requires an explicit `FIRECRAWL_CREDIT_USD` conversion.
- Sol is the default manual draft model. Inco DeepSeek triage and Grok significance review are separately opt-in. Native X retrieval through AI Gateway is unverified; the implemented experiment reviews Scavio-acquired posts.
- HN and Stack Overflow remain research-only. Unknown communities require human rules review, and proposed drafts require evidence review before copy handoff.

No database migration, manual deployment, schedule activation, social publication or DM was performed. Cloudflare packaging, upload dry-run results and code reviews are checked against the final pull request head before merge. Preview authentication and isolated test secrets remain dashboard configuration requirements.
