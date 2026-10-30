# Production acceptance: secrets audit and the one-pass journey

Status: **NOT RUN — awaiting Liam's secret confirmation and his approval to use
his own account.** Owner: Liam Wilson. Prepared by Capy for #107 on 25 October
2026 (Australia/Brisbane), against `main` at `f73546f` (PR #125 merged). This
supersedes the 24 October draft on PR #114, which predates the automatic
first-scan funnel (#125), the digest in-app links and the current `.env.example`.
This is a runbook, not evidence that production works: no production journey,
provider call, email send, deployment or secret change was performed for it.

**Deploy context (confirmed):** production deploys through the GitHub Actions
Deploy workflow (`.github/workflows/deploy.yml`, manual `workflow_dispatch` with
`environment: production` and approval gating); the Worker is `dontkillmyvibe`
on `contextfor.dev` and `www.contextfor.dev`; migrations 0000–0032 are applied
to the production database; staging auto-deploys on every push to `main`.

## Safety and release gates

- Liam alone configures secrets. Never paste values, tokens, cookies, one-time
  codes or connection strings into an issue, PR or this doc. A name appearing in
  a secret list proves it is set, not that the credential is valid or funded.
- Before starting, Liam must confirm the provider secrets, the paid-call opt-in
  and budget, and approve using his own account. The URL derivation, first scan
  and contribution drafting can spend money; stop rather than retry repeatedly.
- Use Liam's own account and a public product URL he owns. Vantage never posts,
  comments or votes for anyone — copying a reply is the endpoint, not publishing.
- Confirm the deployed production version before testing; GitHub `main` is not
  deployment evidence. Stop at a failure, record sanitised evidence, and keep
  #107 open while a gate is unresolved.

## Secrets audit

Inventory sources: `lib/env/server.ts`, `lib/env/client.ts`, `requiredEnv`/
`optionalEnv` call sites, `process.env` reads, `wrangler.jsonc` bindings,
`.env.example` and `.github/workflows/` — all at `main` `f73546f`. Set/unset
status comes from the names-only `wrangler secret list` audit of 24 October 2026
(PR #114) plus Liam's issue comment of the same day; it has **not** been
re-verified against the live Workers since, so treat every *Unconfirmed* row as
unknown, not absent. No secret values were read or printed anywhere.

Table legend:

- **Confirmed** — the name was returned by `wrangler secret list` for that
  Worker (names only), or Liam stated in #107 that it is now set.
- **Unconfirmed** — not returned by the 24 October listing, or never checked.
  `wrangler secret list` cannot see plaintext dashboard variables, so absence
  from that listing alone is not proof a variable is missing.
- **n/a** — set outside the Workers (GitHub Actions secrets, or a plain
  variable in `wrangler.jsonc`).

### Worker runtime secrets and variables (production Worker `dontkillmyvibe`)

| Name | Needed by (source) | Prod status | Staging status | What fails closed without it |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | `lib/db/client.ts` | Confirmed (24 Oct listing) | Confirmed | All database access fails; every workspace path depends on it. |
| `NEON_AUTH_BASE_URL` | `lib/auth/server.ts` | Confirmed | Confirmed | Authentication cannot initialise. |
| `NEON_AUTH_COOKIE_SECRET` | `lib/auth/server.ts` | Confirmed | Confirmed | Auth session cookies cannot be signed. |
| `NEXT_PUBLIC_APP_URL` | `lib/app-url.ts` | Confirmed | Confirmed | Absolute app URLs (digest links, email links) throw in production-mode builds. |
| `CRON_SECRET` | `worker-entry.mjs`, `lib/cron/authorize.ts` | Confirmed | Confirmed | The scheduled handler cannot authenticate its self-requests; `/api/cron/tick` refuses everything (fail-closed 401). |
| `VISITOR_SALT` | `lib/public/guard.ts` | Confirmed (prod only) | Unconfirmed | The unauthenticated public guard cannot hash visitor identity; protected public routes fail closed. |
| `RESEND_API_KEY` | `lib/env/server.ts`, `lib/digest/{dispatch,send}.ts` | Confirmed (Liam, 24 Oct) | Confirmed (Liam, 24 Oct) | Digest emails are skipped, not failed: the cron run still reports success. |
| `DIGEST_FROM_ADDRESS` | `lib/env/server.ts` | Confirmed (Liam, 24 Oct: `digest@updates.contextfor.dev`) | Confirmed (Liam, 24 Oct) | Falls back to `digest@updates.contextfor.dev`; the sending domain must stay verified in Resend. |
| `DIGEST_FROM_NAME` | `lib/env/server.ts` | Unconfirmed | Unconfirmed | Falls back to `Vantage`; cosmetic only. |
| `TURNSTILE_SECRET_KEY` | `lib/public/guard.ts` | Confirmed (Liam, 24 Oct) | Confirmed (Liam, 24 Oct) | The public guard fails closed with 503 on protected public routes. Sign-up itself is Neon Auth and unaffected. |
| `FIRECRAWL_API_KEY` | `lib/firecrawl/{client,search}.ts` | Unconfirmed | Unconfirmed | Firecrawl search lanes (Reddit first choice, web discussions) are unavailable. |
| `FIRECRAWL_CREDIT_USD` | Same Firecrawl clients | Unconfirmed | Unconfirmed | Firecrawl calls refuse to run even with a key: no USD credit price to meter against. |
| `TINYFISH_API_KEY` | `lib/tinyfish/client.ts`, search/fetch | Unconfirmed | Unconfirmed | TinyFish search and fetch unavailable; YouTube/Product Hunt fallbacks degrade. |
| `SCAVIO_API_KEY` | `lib/scavio/client.ts`, Reddit/X/YouTube collectors | Unconfirmed | Unconfirmed | Scavio-backed collection (Reddit search and hydration, X search, YouTube comments) unavailable. |
| `LINKUP_API_KEY` | `lib/linkup/search.ts`, `lib/research` | Unconfirmed | Unconfirmed | Linkup web research and the optional second Reddit lane stay off. |
| `AI_GATEWAY_API_KEY` | `lib/seo-agent/*`, `lib/onboarding/derive.ts`, drafting | Unconfirmed | Unconfirmed | URL-derived monitoring profiles and gateway model calls fail; onboarding falls back to the manual question form. |
| `VANTAGE_PAID_PROVIDERS_ENABLED` | `lib/providers/paid-call.ts` | Unconfirmed | Unconfirmed | Every paid provider call is refused unless exactly `"true"` — keys alone are not enough. |
| `VANTAGE_PAID_DAILY_BUDGET_USD` | `lib/providers/paid-call.ts` | Unconfirmed | Unconfirmed | No global daily USD cap: paid calls are refused unless the provider has its own positive cap. |
| `VANTAGE_PAID_DAILY_BUDGET_<PROVIDER>_USD` | Per-provider overrides (Firecrawl, TinyFish, Scavio, Gateway, AI Gateway, Inco, DataForSEO, Linkup, Tako) | Unconfirmed | Unconfirmed | Each provider falls back to the global cap; without either, that provider's paid calls are refused. |
| `TAKO_SEARCH_USD` | `lib/research/tako.ts` | Unconfirmed | Unconfirmed | Defaults to `0.007` (fast search, $7 per 1,000 since 28 Oct 2026). Every call reserves through `runPaidCall` under the Gateway budget. Do not set `0` in staging or production: that skips the cap. |
| `REDDIT_HYDRATE_DAILY_MAX` | `lib/reddit/client.ts` | Unconfirmed | Unconfirmed | Defaults to 5 hydrations per workspace per UTC day. |
| `REDDIT_LINKUP_LANE` / `REDDIT_LINKUP_DAILY_MAX` | `lib/reddit/client.ts` | Unconfirmed | Unconfirmed | Second Reddit lane stays off (default) / 20 searches per workspace per day. |
| `SCAVIO_GOOGLE_COST_USD` | `lib/collectors/linkedin.ts` | Unconfirmed | Unconfirmed | Indexed LinkedIn discovery refuses to run without a positive unit cost. |
| `NEXT_PUBLIC_SITE_URL` | `lib/site.ts` | Unconfirmed | Unconfirmed | Marketing URLs default to `https://contextfor.dev`; browser settings compile at build time. |
| `PH_DEV_TOKEN` | `lib/producthunt/client.ts` | Unconfirmed | Unconfirmed | Product Hunt API lane unavailable; production scheduling excludes it anyway. |
| `YOUTUBE_API_KEY` | `lib/youtube/client.ts` | Unconfirmed | Unconfirmed | YouTube Data API lane unavailable; production scheduling excludes it anyway. |
| `CF_AIG_BASE_URL` / `CF_AIG_TOKEN` | `lib/drafting/contribution.ts` | Unconfirmed | Unconfirmed | Drafts use `AI_GATEWAY_API_KEY` directly instead of a Cloudflare AI Gateway endpoint. |
| `DATAFORSEO_*` | `lib/dataforseo/*` (login/password, env, budgets, model pins) | Unconfirmed | Unconfirmed | DataForSEO research unavailable; sandbox mode is refused in production without fixtures. |
| `INCO_API_KEY` / `INCO_TRIAGE_ENABLED` | `lib/drafting/contribution.ts` | Unconfirmed | Unconfirmed | Optional Inco triage stays off. |
| `X_GATEWAY_EXPERIMENT_ENABLED` / `X_GATEWAY_MODEL` | `lib/x/{client,gateway}.ts` | Unconfirmed | Unconfirmed | Optional X/Grok analysis experiment stays off. |
| `SEO_AGENT_*` / `SEO_CLASSIFIER_*` / `SEO_MODEL_PRICES_JSON` | `lib/seo-agent/*` | Unconfirmed | Unconfirmed | Committed defaults are used; no functional failure. |
| `VANTAGE_LEARNING_*` | `lib/learning/config.ts` | Unconfirmed | Unconfirmed | Learning stays disabled with conservative defaults; the deterministic ranker runs. |
| `VANTAGE_ADMIN_USER_IDS` | `lib/auth/admin.ts` | Unconfirmed | Unconfirmed | Admin allow-list empty: admin routes 404 for everyone. |
| `PUBLIC_DAILY_BUDGET_USD` | `lib/public/budget.ts` | Unconfirmed | Unconfirmed | Public paid budget defaults to 5 USD/day. |
| `ENABLE_PUBLIC_PING` | `app/api/public/ping/route.ts` | Unconfirmed | Unconfirmed | Test ping route stays off; not an acceptance endpoint. |
| `ALLOW_FIXTURES` / `VANTAGE_DEMO_FIXTURES` | `lib/collectors/provenance.ts`, reddit/X clients | Unconfirmed | Unconfirmed | Fixture sample data fails closed in production. **Keep unset — do not set for this test.** |
| `TURNSTILE_DEV_BYPASS` | `lib/public/guard.ts` | Unconfirmed | Unconfirmed | No dev bypass; deliberately ignored in production. **Keep unset.** |
| `POLAR_ACCESS_TOKEN` / `POLAR_WEBHOOK_SECRET` / `POLAR_SERVER` | `lib/billing/*` | Confirmed (24 Oct listing, prod) | Unconfirmed | Billing API and webhook signature checks unavailable; billing is not part of this acceptance test. |
| `JINA_API_KEY` | No current runtime reader (planned knowledge-base work) | Unconfirmed | Unconfirmed | Nothing fails today; the planned Jina path cannot authenticate later. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | No current runtime reader | Unconfirmed | Unconfirmed | No error reporting is wired today; use `wrangler tail` and the dashboard instead. |
| `NEXT_PUBLIC_POSTHOG_KEY`/`_HOST`, `POSTHOG_API_KEY`/`HOST` | No current runtime reader | Unconfirmed | Unconfirmed | No analytics reporting is wired today. |
| `NODE_ENV` | Framework (production safety checks, fixture refusal) | Set by the platform | Set by the platform | Never override manually. |

### GitHub Actions secrets (Settings → Secrets and variables → Actions, per environment)

| Name | Read by | Used for | Status | What fails without it |
| --- | --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | `deploy.yml` | `wrangler deploy` for staging and production | Confirmed in effect — staging auto-deploys and the last production deploys succeeded | Deploy workflow fails before uploading the Worker. |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy.yml` | Cloudflare account target | Confirmed in effect (same runs) | Deploy workflow fails. |
| `DATABASE_URL` | `deploy.yml` (only when `run_migrations` is ticked; production-environment scoped) | `pnpm db:migrate` against the direct (non-pooler) endpoint | Unconfirmed for the `production` environment — the workflow errors with an explicit message if it is missing when migrations are requested | The migration step aborts; the deploy itself still proceeds. |
| CI runs no other secrets | `ci.yml` | Lint, typecheck, tests, migration drift, build, Worker bundle/smoke | n/a | CI is deliberately secret-free ("the build must not need real secrets"). |

### Cloudflare bindings (declared in `wrangler.jsonc`, not secrets)

`ASSETS`, `WORKER_SELF_REFERENCE`, `BROWSER`, `AI`, `VECTORIZE`, `EMBED_QUEUE`
(+ dead-letter queue), `ARTIFACTS` (R2), `RADAR_LIMITER` and the `SCAN`
workflow binding are all declared for production. A binding name in config does
not prove the resource exists on the account: before first deploy, confirm the
queues `vantage-embed-jobs` and `vantage-embed-dlq`, the Vectorize index, the
`vantage-artifacts` bucket and the `vantage-scan` workflow all exist. Missing
bindings degrade the features that use them (semantic scoring, embeddings,
browser rendering, artifacts) and the entry falls back to the cron tick without
`SCAN`. `HYPERDRIVE`/`HYPERDRIVE_FRESH` are optional and not declared; the
client falls back to Neon HTTP.

### Re-verifying the audit (names only, no values)

From a machine with Wrangler credentials, list secret **names** and compare
against the table above; a re-run that shows the *Unconfirmed* provider keys
still missing is the expected result until Liam adds them:

```powershell
Set-Location 'C:\Users\install\workspace\vantage'
$env:WRANGLER_LOAD_DOT_ENV_FILES = 'false'
npx --no-install wrangler secret list --name dontkillmyvibe
npx --no-install wrangler secret list --env staging
```

## Production acceptance test (one pass, Liam's account)

Record **PASS**, **FAIL**, **BLOCKED** or **NOT RUN** per step; never infer a
pass from code or CI. Run the steps in order, in one sitting, at the deployed
production version (check the Deploy workflow run or
`npx --no-install wrangler deployments list --name dontkillmyvibe` first).
Screenshots must hide email addresses, codes and private text.

Watch for errors while testing, in a second terminal (a tail is a live stream;
it does not show history):

```powershell
Set-Location 'C:\Users\install\workspace\vantage'
$env:WRANGLER_LOAD_DOT_ENV_FILES = 'false'
npx --no-install wrangler tail dontkillmyvibe --format pretty
```

Use the Cloudflare dashboard (**Workers & Pages → dontkillmyvibe →
Observability/Metrics**) for historical invocations, and **Workflows** for the
`vantage-scan` instance status. In Resend, check Liam's delivery status only.

| # | Step | Exact URL / action | Expected result |
| --- | --- | --- | --- |
| 0 | Gates | Deploy run + secret table above | Deployed version confirmed; provider secrets and paid budget confirmed; Liam's account approval given. |
| 1 | Sign up | `https://contextfor.dev/auth/sign-up` | Sign-up completes with Liam's own email; he verifies privately; he lands signed-in in his new workspace with no 500 and no other workspace's data. |
| 2 | Submit URL | `https://contextfor.dev/workspace?setup=1` | Paste a public product URL Liam owns. The derived **product profile** reflects that site (not a generic sample); no browser errors in the tail. The manual-question fallback is acceptable behaviour but does not pass this step. |
| 3 | Confirm profile | Same page | Correct any wrong fields, confirm each (or **Looks right**), answer the digest-hour question with `8am`, and check the displayed zone is Liam's actual zone (`Australia/Brisbane` per this thread's settings — confirm on screen, do not assume). Reload: the confirmed profile and schedule persist. Confirming must also start the first scan automatically (see step 4). |
| 4 | First scan | Same page, then `https://contextfor.dev/queue` | After profile confirm, a first scan starts on its own (no manual trigger), runs within the budgeted allowance, and finishes with real read/relevant/picked counts plus a clear end state or next scan time. The first-scan completion email arrives (`sendFirstScanEmail`). Record counts and duration. |
| 5 | Five conversations | `https://contextfor.dev/queue` | The queue shows up to five current, relevant conversations with platform, score, reason and source links, and no fixture/sample labels. Record the real count; an honest empty state is a FAIL for this step, not a pass. |
| 6 | Digest at local hour | `https://contextfor.dev/settings/digest` | Enable delivery to Liam's address; keep the existing hour rather than rewriting the UTC slot. The email arrives at the scheduled local hour via the ordinary hourly cron (never call the cron endpoint manually; a first-ever catch-up send may arrive immediately and does not prove local-hour timing — wait for the next eligible slot). Email contains up to five opportunities from the verified sender `digest@updates.contextfor.dev`, with no duplicates. |
| 7 | Open from email | The digest email's **Review** link | Clicking an opportunity opens `https://contextfor.dev/opportunities/<id>` inside Liam's signed-in workspace — not the external source. The **Original conversation** external link is a separate follow-up click. Signed-out state must return him to the same in-app page after sign-in. |
| 8 | Copy a reply | The opportunity page | With Liam's spend approval, choose **Generate contribution**, check facts and community rules, tick the confirmations, then **Approve & copy draft**. Clipboard text verifies in a local editor and survives a reload where the app persists the state. Note: main does not yet persist a dedicated `reply_copied` outcome event (see gaps). Nothing is ever posted, commented or voted. |

**Known gaps on `main` `f73546f` (do not paper over them in the ledger):**

- Step 8: `lib/outcomes/types.ts` defines no `reply_copied` event, so a copied
  reply cannot yet be verified as a persisted outcome — record clipboard
  verification only, and keep this gate open until the outcome event ships.
- The scan-start toast/copy around step 4: per-source "Scan this source" false
  failures were fixed in #130, but the automatic first-scan path (#125) has not
  been exercised in production before — treat any swallowed error as FAIL with
  the tail excerpt as evidence.

## Evidence ledger

Configuration confirmation: **NOT RECEIVED**. Account/spend approval: **NOT
RECEIVED**. Deployed version: **NOT CHECKED**. Journey: **NOT RUN**.

| Step | Status | Timestamp (local + UTC) | Sanitised evidence |
| --- | --- | --- | --- |
| 0 | BLOCKED | — | Awaiting Liam's confirmations. |
| 1–8 | NOT RUN | — | No account interaction performed. |

Replace NOT RUN with the observed result, times and minimal sanitised evidence.
A failure entry needs expected versus actual behaviour. No full-journey pass and
no closure of #107 until every gate has observed evidence and the secret table's
*Unconfirmed* rows relevant to the journey (provider keys, paid opt-in and
budget) are resolved by Liam.
