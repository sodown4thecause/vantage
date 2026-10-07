# Community GTM phase validation

Validated on 7 October 2026 in the isolated `codex/community-gtm-phase` worktree, based on `a221c021f3faff060e271a3e6ae39ece6902833b`.

This receipt covers application code revision `6065dddc4d82a12e6a75ee47ded14449218fa869`. The [application CI job](https://github.com/sodown4thecause/vantage/actions/runs/37617612283/job/112779657944) and [Worker CI job](https://github.com/sodown4thecause/vantage/actions/runs/37617612283/job/112779658042) both pass on that revision. Later documentation corrections do not change that application code; checks and reviews are rechecked against the final PR head before merge.

## Application checks

| Check | Result |
| --- | --- |
| TypeScript (`tsc --noEmit`) | Pass |
| ESLint (`eslint`) | Full review checkout passes |
| Vitest (`vitest run --maxWorkers=1`) | 539 tests in 57 files pass |
| Scheduled Worker wrapper (`node --test test/worker-entry.test.mjs`) | 5 tests pass |
| Migration generation (`drizzle-kit generate`) | No schema changes; migration and metadata match the checkout |
| Next production build (`pnpm run build`) | Pass |
| Cloudflare bundle and staging upload dry run | Pass; one OpenNext build and no repeated custom build in the named staging dry run |
| Actual Cloudflare preview upload | Pass on application code revision `6065ddd` |
| Independent branch review | Greptile 5/5 on application code revision `6065ddd`, with no remaining code findings; final PR review is required before merge |

Regression checks reproduce and fix changed-query cursors, shifting activity pages, malformed external response fields and final-page dataset truncation. Direct Server Actions preserve progressive enhancement. Authenticated draft GET requests accept an optional target UUID; the repository retrieves the newest exact target within the workspace and opportunity before falling back to a legacy row with no quality metadata. Legacy text remains visibly labelled and blocked from approval and copy handoff until regeneration. Migration `0017_community_draft_lookup.sql` adds indexes for exact-target, legacy and global newest-draft lookup; its generated SQL, snapshot and journal agree.

Indexed LinkedIn responses retain reported costs while recording unusable responses as failed attempts before errors propagate. Tests cover zero and positive failure costs, failed ledger writes and missing settlement rows. Grok and Alexandria parse external JSON as unknown and narrow objects and record arrays before use; malformed Alexandria JSON returns a fixed error without provider-body fragments. Grok preserves literal acquired posts, rejects invented URLs or invalid scores, and records known usage before interpreting model output. Stack Overflow tests recover delayed-visible activity across a saved boundary using a 60-second settlement margin and 300-second completed-window overlap without adding API requests. These margins do not promise a consistent snapshot or complete coverage beyond the bounded overlap.

Review checks use Node 22 in Ubuntu WSL, matching GitHub CI. The supplied Cloudflare log uses Node 24. Tests mock paid provider calls. Builds use non-secret CI placeholders, and the Linux source mirror is compared with changed application, test and migration files before validation.

Review fixes have regression coverage: every complete proposed sentence needs a claim ledger entry, including advice and questions; abbreviations preserve sentence boundaries; malformed stored quality cannot bypass approval; approval checks the exact reviewed edit; unknown API failures cannot expose database messages; rate-limited collection preserves accepted evidence and resumable progress; incomplete empty results remain partial; ambiguous cost writes retain a durable reservation token; concurrent source additions share the workspace lease and reserve the onboarding source slot; source changes invalidate stale drafts and async responses. Quoted research briefs remain distinct from proposed comments.

The supplied preview log confirms that Next compiled successfully before `wrangler preview` rejected a missing `previews` block. The fixed configuration passes the actual branch-preview upload. The top-level custom `cf:build` hook supports raw dashboard preview commands; named staging and production configurations suppress it with an empty command because their CI workflows already build OpenNext explicitly. A read-only call to the installed Wrangler configuration reader confirms the overrides take precedence and skip the custom hook. Successful preview upload does not confirm configured runtime authentication or isolated test secrets.

## Provider evidence and activation

The separate [provider receipts](2026-10-07-provider-verification.json) record current model IDs, rates, Alexandria contracts and samples, primary contribution rules, and a TinyFish connector sample. The [source runbook](../sources/community-collection.md) records verified public feeds. These checks do not prove authenticated application access to those providers.

- Apply pending migrations `0016_community_gtm_phase.sql` and `0017_community_draft_lookup.sql` through the existing staging acceptance process before enabling this code against a database.
- Install selected catalog entries in source settings; existing workspace source limits apply. Public feeds and official GitHub/Stack Overflow endpoints remain in the free scheduled lane.
- Supply application provider keys through the existing secret mechanism. Paid calls additionally require `VANTAGE_PAID_PROVIDERS_ENABLED=true` and a positive `VANTAGE_PAID_DAILY_BUDGET_USD`. Alexandria also requires an explicit `FIRECRAWL_CREDIT_USD` conversion.
- Sol is the default manual draft model. Inco DeepSeek triage and Grok significance review are separately opt-in. Native X retrieval through AI Gateway is unverified; the implemented experiment reviews Scavio-acquired posts.
- HN and Stack Overflow remain research-only. Unknown communities require human rules review, and proposed drafts require evidence review before copy handoff.

No database migration, manual deployment, schedule activation, social publication or DM was performed. Cloudflare packaging, upload dry-run results and code reviews are checked against the final pull request head before merge. Preview authentication and isolated test secrets remain dashboard configuration requirements.
