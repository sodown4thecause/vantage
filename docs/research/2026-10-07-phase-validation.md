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
| Cloudflare bundle and staging upload dry run | First PR head passes both GitHub CI jobs; final head is checked again before merge |
| Independent branch review | Findings addressed with regression coverage; final PR review is required before merge |

Review checks use Node 22 in Ubuntu WSL, matching GitHub CI. The supplied Cloudflare log uses Node 24. Tests mock paid provider calls. Builds use non-secret CI placeholders, and the Linux source mirror is compared with changed application, test and migration files before validation.

Review fixes have regression coverage: every complete proposed sentence needs a claim ledger entry, including advice and questions; abbreviations preserve sentence boundaries; malformed stored quality cannot bypass approval; approval checks the exact reviewed edit; unknown API failures cannot expose database messages; rate-limited collection preserves accepted evidence and resumable progress; incomplete empty results remain partial; ambiguous cost writes retain a durable reservation token; concurrent source additions share the workspace lease and reserve the onboarding source slot; source changes invalidate stale drafts and async responses. Quoted research briefs remain distinct from proposed comments.

The supplied preview log confirms that Next compiled successfully before `wrangler preview` rejected a missing `previews` block. The configuration now has an empty preview block and a Wrangler custom build that runs `cf:build`, so the raw dashboard command can build the OpenNext Worker bundle. This was validated against the installed Wrangler/OpenNext contracts. A successful local Next build alone does not confirm preview upload or configured preview secrets.

## Provider evidence and activation

The separate [provider receipts](2026-10-07-provider-verification.json) record current model IDs, rates, Alexandria contracts and samples, primary contribution rules, and a TinyFish connector sample. The [source runbook](../sources/community-collection.md) records verified public feeds. These checks do not prove authenticated application access to those providers.

- Apply migration `0016_community_gtm_phase.sql` through the existing staging acceptance process before enabling this code against a database.
- Install selected catalog entries in source settings; existing workspace source limits apply. Public feeds and official GitHub/Stack Overflow endpoints remain in the free scheduled lane.
- Supply application provider keys through the existing secret mechanism. Paid calls additionally require `VANTAGE_PAID_PROVIDERS_ENABLED=true` and a positive `VANTAGE_PAID_DAILY_BUDGET_USD`. Alexandria also requires an explicit `FIRECRAWL_CREDIT_USD` conversion.
- Sol is the default manual draft model. Inco DeepSeek triage and Grok significance review are separately opt-in. Native X retrieval through AI Gateway is unverified; the implemented experiment reviews Scavio-acquired posts.
- HN and Stack Overflow remain research-only. Unknown communities require human rules review, and proposed drafts require evidence review before copy handoff.

No database migration, manual deployment, schedule activation, social publication or DM was performed. Cloudflare packaging, upload dry-run results and code reviews are checked against the final pull request head before merge. Preview authentication and isolated test secrets remain dashboard configuration requirements.
