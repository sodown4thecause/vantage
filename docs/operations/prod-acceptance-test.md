# Production acceptance: tomorrow morning, five conversations

Status: **NOT RUN — awaiting Liam's secrets confirmation and approval to use his own account.**
Owner: Liam Wilson. Prepared by Capy VANT-102 for #107 on 24 October 2026
(Australia/Sydney), against `main` at `4469e4523ba9eb48f70d0f090e3a707d47e0d0a0`.
This is a runbook, not evidence that production works. No production journey,
provider request, email send, deployment or secret change was performed for it.

## Safety and release gates

- Liam alone configures secrets. Never paste values, tokens, cookies, one-time
  codes, connection strings or full email contents into an issue, PR or this doc.
  Names being present does not prove credentials are valid or funded.
- Before starting, Liam must confirm the required secrets, verified Resend sender,
  provider access and an explicit paid-call budget, then approve the account test.
  Do not enable paid providers or choose a budget on his behalf. The URL derivation,
  scans and contribution generation can spend money; stop rather than repeatedly retry.
- Use Liam's own account and a public product URL he owns. No checkout, subscription
  change, deletion, fixture enablement, cron replay or forced email. Vantage never
  posts, comments or votes for anyone. Copying a reply is the endpoint, not publishing it.
- Confirm the deployed production version before testing; GitHub `main` is not
  deployment evidence. Unmerged or undeployed features must not receive a pass.
  Do not merge or deploy as part of this runbook.
- Stop at a failure, record the sanitised evidence, and keep #107 open and `blocked`
  while awaiting Liam or a missing release. Do not work around a failing gate to
  claim that the complete journey passed.

## Names-only configuration audit

Observed on 24 October 2026: production Worker `dontkillmyvibe` listed nine
secrets; staging Worker `vantage-staging` listed five. The installed Wrangler
4.151.1 was used read-only from the isolated checkout after the `npx` bootstrap
timed out. No secret values or local secret files were read or printed.

The source inventory covers `process.env`, functions receiving `process.env`
(including `env.NAME` and dynamic lookups), `requiredEnv`/`optionalEnv`, Cloudflare
request-context bindings and the Worker entry/workflows. Tests, CLI credentials,
build-only settings and migration-only settings are not runtime requirements.

Table legend: **Yes** = name returned by the Worker secret list. **No*** = not
returned; it does **not** prove absence from dashboard plaintext variables or a
compiled browser bundle. **Config** = declared in committed `wrangler.jsonc`,
not checked on the deployed version. Inspect names/configuration in the dashboard
without exporting values before treating optional settings as absent.

### Core, provider and email configuration

| Name | Needed by (source) | Set in prod? | Set in staging? | What breaks if missing |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | `lib/db/client.ts` | Yes | Yes | Default Neon database access fails; all workspace data paths depend on it. |
| `NEON_AUTH_BASE_URL` | `lib/auth/server.ts` | Yes | Yes | Authentication cannot initialise. |
| `NEON_AUTH_COOKIE_SECRET` | `lib/auth/server.ts` | Yes | Yes | Auth cookie protection cannot initialise. |
| `NEXT_PUBLIC_APP_URL` | `lib/app-url.ts` | Yes | Yes | Production absolute app URL construction throws. |
| `NEXT_PUBLIC_SITE_URL` | `lib/site.ts` | No* | No* | Marketing URL defaults to `https://contextfor.dev`; browser/public settings may be compiled at build time. |
| `CRON_SECRET` | `worker-entry.mjs`, `worker/workflows.mjs`, `lib/cron/authorize.ts` | Yes | Yes | Scheduled self-requests stop; cron/internal routes refuse unauthorised requests. |
| **`FIRECRAWL_API_KEY`** | `lib/firecrawl/{client,search}.ts`, provider source selection | **No*** | **No*** | Firecrawl search/index calls unavailable; fewer discovery lanes. |
| **`FIRECRAWL_CREDIT_USD`** | Same Firecrawl clients | **No*** | **No*** | Calls refuse an absent/non-positive credit-to-USD conversion even with a key. |
| **`TINYFISH_API_KEY`** | `lib/tinyfish/client.ts`, URL reader and collectors | **No*** | **No*** | TinyFish search/fetch/rendering unavailable; direct public URL fetch can still work. |
| **`SCAVIO_API_KEY`** | `lib/scavio/client.ts`, social collectors | **No*** | **No*** | Scavio social collection unavailable. |
| `SCAVIO_GOOGLE_COST_USD` | `lib/collectors/linkedin.ts` | No* | No* | Indexed LinkedIn calls require a positive unit cost and refuse otherwise. |
| **`AI_GATEWAY_API_KEY`** | `lib/seo-agent/{model-config,models}.ts`, `lib/onboarding/derive.ts`, drafts/X gateway | **No*** | **No*** | URL-derived profile and gateway-backed agent disabled; direct gateway drafts unavailable. |
| `VANTAGE_PAID_PROVIDERS_ENABLED` | `lib/providers/paid-call.ts`, collectors | No* | No* | Paid calls fail closed unless exactly `true`; setting keys alone is insufficient. |
| `VANTAGE_PAID_DAILY_BUDGET_USD` | `lib/providers/paid-call.ts` | No* | No* | No global positive cap: calls refuse unless their provider has its own positive cap. Caps apply per provider per UTC day, not as one shared total. |
| `VANTAGE_PAID_DAILY_BUDGET_FIRECRAWL_USD` | Dynamic provider cap | No* | No* | Falls back to global cap. |
| `VANTAGE_PAID_DAILY_BUDGET_TINYFISH_USD` | Dynamic provider cap | No* | No* | Falls back to global cap. |
| `VANTAGE_PAID_DAILY_BUDGET_SCAVIO_USD` | Dynamic provider cap | No* | No* | Falls back to global cap. |
| `VANTAGE_PAID_DAILY_BUDGET_GATEWAY_USD` | Dynamic provider cap: onboarding/agents/drafts | No* | No* | Falls back to global cap. |
| `VANTAGE_PAID_DAILY_BUDGET_AI_GATEWAY_USD` | Dynamic provider cap: X gateway experiment | No* | No* | Falls back to global cap; distinct from `GATEWAY`. |
| `VANTAGE_PAID_DAILY_BUDGET_INCO_USD` | Dynamic provider cap: optional triage | No* | No* | Falls back to global cap. |
| **`RESEND_API_KEY`** | `lib/env/server.ts`, `lib/digest/{dispatch,send}.ts` | **No*** | **No*** | Digests skip sending; a successful cron response can still mean no email was sent. |
| `DIGEST_FROM_ADDRESS` | `lib/env/server.ts` | No* | No* | Defaults to `digest@contextfor.dev`; sender must be verified in Resend. |
| `DIGEST_FROM_NAME` | `lib/env/server.ts` | No* | No* | Defaults to `contextfor.dev`. |
| **`TURNSTILE_SECRET_KEY`** | `lib/public/guard.ts` | **No*** | **No*** | Protected public requests fail closed in production, not necessarily account sign-up (Neon Auth is separate). |
| `VISITOR_SALT` | `lib/public/guard.ts` | Yes | No* | Protected public visitor identity unavailable in production. |
| `PUBLIC_DAILY_BUDGET_USD` | `lib/public/budget.ts` | No* | No* | Public paid budget defaults to zero; public paid work denied. |
| `ENABLE_PUBLIC_PING` | `app/api/public/ping/route.ts` | No* | No* | Public ping disabled unless exactly `true`; not an acceptance health endpoint. |
| `TURNSTILE_DEV_BYPASS` | `lib/public/guard.ts` | No* | No* | No development bypass; intentionally ignored in production. |
| `NODE_ENV` | Database, URL, collectors, public guards, fixture safety | Framework | Framework | Framework-controlled production safety; never override for this test. |
| `ALLOW_FIXTURES` | `lib/collectors/provenance.ts` | No* | No* | Production sample data denied by default; keep it that way. |
| `VANTAGE_DEMO_FIXTURES` | `lib/{reddit,x}/client.ts` | No* | No* | Demo fallback off; does not enable production fixtures. |
| `PH_DEV_TOKEN` | `lib/producthunt/client.ts` | No* | No* | Product Hunt API token path unavailable; production scheduling separately excludes this lane. |
| `YOUTUBE_API_KEY` | `lib/youtube/client.ts` | No* | No* | YouTube Data API path unavailable; other keyed paths differ and production scheduling excludes this lane. |

### Model routing, optional research, learning and existing billing

These are inventory entries, not instructions to enable unrelated features.

| Name | Needed by (source) | Set in prod? | Set in staging? | What breaks if missing |
| --- | --- | --- | --- | --- |
| `CF_AIG_BASE_URL` | `lib/drafting/contribution.ts` | No* | No* | Drafts use Vercel AI Gateway instead of a Cloudflare gateway endpoint. |
| `CF_AIG_TOKEN` | Same draft endpoint resolver | No* | No* | Optional token omitted on Cloudflare gateway requests; endpoint policy may refuse them. |
| `COMMENT_DRAFT_MODEL` | `lib/drafting/contribution.ts` | No* | No* | Uses the committed default draft model. |
| `INCO_API_KEY` | Same contribution module | No* | No* | Optional Inco triage unavailable when enabled. |
| `INCO_TRIAGE_ENABLED` | Same contribution module | No* | No* | Optional Inco triage remains off. |
| `SEO_AGENT_MODEL` | `lib/seo-agent/model-config.ts` | No* | No* | Uses the committed executor default. |
| `SEO_CLASSIFIER_MODEL` | Same model configuration | No* | No* | Uses the committed classifier default. |
| `SEO_AGENT_FALLBACK_MODEL` | Same model configuration | No* | No* | No optional fallback override. |
| `SEO_CLASSIFIER_SPEED` | `lib/seo-agent/models.ts` | No* | No* | No optional gateway speed preference. |
| `SEO_MODEL_PRICES_JSON` | Same pricing resolver | No* | No* | Only built-in model prices available; otherwise paid-call estimates apply. |
| `SEO_AGENT_AUTO_CREDITS` | `lib/seo-agent/budget.ts` | No* | No* | Uses default automatic approval threshold. |
| `SEO_AGENT_GEO_ALWAYS_ASK` | Same approval policy | No* | No* | Geographic research continues to require approval by default. |
| `X_GATEWAY_EXPERIMENT_ENABLED` | `lib/x/client.ts` | No* | No* | Optional X gateway experiment off. |
| `X_GATEWAY_MODEL` | `lib/x/gateway.ts` | No* | No* | Uses the committed X gateway default. |
| `DATAFORSEO_LOGIN` | `lib/dataforseo/config.ts` | No* | No* | Falls back to nonblank `DATAFORSEO_USERNAME` when missing or blank; credentials require either login name plus `DATAFORSEO_PASSWORD`. |
| `DATAFORSEO_USERNAME` | Same login alias | No* | No* | Optional alias, ignored when `DATAFORSEO_LOGIN` is nonblank; credentials require either login name plus `DATAFORSEO_PASSWORD`. |
| `DATAFORSEO_PASSWORD` | Same config | No* | No* | DataForSEO unavailable. |
| `DATAFORSEO_ENV` | Same config | No* | No* | Defaults to sandbox; sandbox blocked under production fixture policy. |
| `DATAFORSEO_DAILY_BUDGET_USD` | Same config | No* | No* | Uses committed default daily budget. |
| `DATAFORSEO_RESERVE_FLOOR_USD` | Same config | No* | No* | Uses committed default reserve floor. |
| `DATAFORSEO_ALERT_BALANCE_USD` | Same config | No* | No* | Uses committed default low-balance threshold. |
| `DATAFORSEO_LLM_MODEL_CHAT_GPT` | `lib/dataforseo/ai-optimization.ts` dynamic engine model | No* | No* | Discovers an available model instead of an override. |
| `DATAFORSEO_LLM_MODEL_CLAUDE` | Same model resolver | No* | No* | Discovers an available model instead of an override. |
| `DATAFORSEO_LLM_MODEL_GEMINI` | Same model resolver | No* | No* | Discovers an available model instead of an override. |
| `DATAFORSEO_LLM_MODEL_PERPLEXITY` | Same model resolver | No* | No* | Discovers an available model instead of an override. |
| `VANTAGE_ADMIN_USER_IDS` | `lib/auth/admin.ts` | No* | No* | Admin allow-list empty; admin-only operations refused. |
| `VANTAGE_DB_DRIVER` | `lib/db/client.ts` | No* | No* | Defaults to Neon HTTP; do not switch drivers for acceptance. |
| `VANTAGE_SEMANTIC_MODE` | `lib/cf/env.ts` | Config | Config | Unset/unrecognised means semantic scoring off; top-level config says off, explicit production/staging say shadow. Deployment target matters. |
| `VANTAGE_LEARNING_ENABLED` | `lib/learning/config.ts` | No* | No* | Uses conservative committed learning default. |
| `VANTAGE_LEARNING_MIN_EVIDENCE` | Same learning config | No* | No* | Uses default workspace evidence threshold. |
| `VANTAGE_LEARNING_MIN_KEY_EVIDENCE` | Same learning config | No* | No* | Uses default per-key evidence threshold. |
| `VANTAGE_LEARNING_MAX_WEIGHT` | Same learning config | No* | No* | Uses default maximum weight. |
| `VANTAGE_LEARNING_MAX_DELTA` | Same learning config | No* | No* | Uses default maximum score delta. |
| `VANTAGE_LEARNING_MAX_RANK_SHIFT` | Same learning config | No* | No* | Uses default maximum rank movement. |
| `VANTAGE_LEARNING_K` | Same learning config | No* | No* | Uses default smoothing constant. |
| `POLAR_ACCESS_TOKEN` | `lib/billing/polar.ts` | Yes | No* | Polar API unavailable; no billing testing is authorised here. |
| `POLAR_SERVER` | Same Polar config | Yes | No* | Defaults to sandbox, not production. |
| `POLAR_WEBHOOK_SECRET` | `lib/billing/webhook.ts` | Yes | No* | Billing webhook signature validation unavailable. |

### Explicitly requested future integration names

No runtime reads or Sentry/PostHog dependencies were found on this main revision.
Do not invent integration status or assume adding a key implements telemetry.
The PostHog names below are candidate conventions, not an established contract;
repeat the source audit after the observability implementation lands.

| Name | Needed by | Set in prod? | Set in staging? | What breaks if missing |
| --- | --- | --- | --- | --- |
| **`JINA_API_KEY`** | Planned knowledge-base embedding/reranking; no current reader | **No*** | **No*** | No current runtime path affected; planned Jina work cannot authenticate. |
| **`LINKUP_API_KEY`** | Planned research; no current reader | **No*** | **No*** | No current runtime path affected; planned Linkup work cannot authenticate. |
| **`SENTRY_DSN`** | Planned server error reporting; no current reader | **No*** | **No*** | No Sentry reporting demonstrated; cannot validate errors using Sentry yet. |
| `NEXT_PUBLIC_SENTRY_DSN` | Possible future browser error reporting; no current reader | No* | No* | No browser error reporting demonstrated. |
| **`NEXT_PUBLIC_POSTHOG_KEY`** | Possible browser analytics project key; no current reader | **No*** | **No*** | No browser funnel reporting demonstrated. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Possible browser analytics host; no current reader | No* | No* | Future integration must define its host/proxy contract. |
| **`POSTHOG_API_KEY`** | Possible server analytics project key; no current reader | **No*** | **No*** | No server funnel reporting demonstrated; never substitute a personal administration token. |
| `POSTHOG_HOST` | Possible server analytics host; no current reader | No* | No* | Future integration must define its host contract. |

### Cloudflare bindings (not secrets)

`getCloudflareContext().env`, `readBinding` and Worker handlers also read these.
Secret listing cannot establish whether a live binding works.

| Name | Needed by | Set in prod? | Set in staging? | What breaks if missing |
| --- | --- | --- | --- | --- |
| `ASSETS` | Generated OpenNext Worker/static assets | Config | Config | Static asset serving unavailable. |
| `WORKER_SELF_REFERENCE` | Scheduled handler/workflows | Config | Config | Internal scan and digest self-fetches cannot run. |
| `SCAN` | `worker-entry.mjs` workflow orchestration | Config | Config | Workflow orchestration unavailable; entry uses fallback tick when absent. |
| `AI` | `lib/cf/env.ts` | Config | Config | Workers AI semantic features unavailable. |
| `VECTORIZE` | Same binding accessors | Config | Config | Semantic vector retrieval/indexing unavailable. |
| `EMBED_QUEUE` | `lib/cf/queue.ts` | Config | Config | Queued embedding dispatch unavailable. |
| `ARTIFACTS` | `lib/r2/artifacts.ts` | Config | Config | R2 artifact storage unavailable. |
| `BROWSER` | `lib/browser/run.ts` | Config | Config | Browser Rendering unavailable. |
| `RADAR_LIMITER` | `lib/public/guard.ts` | Config | Config | Production public rate-limiter protection unavailable. |
| `HYPERDRIVE` | `lib/db/client.ts` optional cached connection | Not declared | Not declared | Optional Hyperdrive driver falls back to Neon HTTP. |
| `HYPERDRIVE_FRESH` | Same optional fresh connection | Not declared | Not declared | Same fallback; do not enable this driver here. |

## Read-only monitoring and repeat audit

Commands below are for **Windows PowerShell** and use Liam's checkout path
stated in #107: `C:\Users\install\workspace\vantage`. This path has not been
verified on his device; the linked device root differed. Before running a block,
verify or replace its `Set-Location` path with the full Windows path to your
actual checkout (the folder containing `package.json` and `wrangler.jsonc`).
For repository changes, use a fresh isolated worktree off the latest `main` as
required by #107, and substitute that worktree's full path instead.
`Set-Location` changes the current folder; stop if it fails so later commands
do not run in the wrong checkout. No agent-specific worktree path is required.
`npx --no-install` uses installed tooling without downloading a newer CLI.
Install the lockfile dependencies first if it reports a missing executable.
Do not copy secrets into shell arguments or load a production `.env.local`.

```powershell
Set-Location 'C:\Users\install\workspace\vantage'
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_LOAD_DOT_ENV_FILES = 'false'
npx --no-install wrangler secret list --name dontkillmyvibe
npx --no-install wrangler secret list --env staging
npx --no-install wrangler deployments list --name dontkillmyvibe
```

The default production target above is the same Worker name as explicit
`--env production`; staging is `--env staging`, not a production custom domain.
Compare deployment version/time with the release Liam authorised. These commands
list metadata only; none deploys or changes secrets.

A tail is a live log stream; it does not replay historical logs. In a separate
PowerShell terminal at the same repository root, watch the production test:

```powershell
Set-Location 'C:\Users\install\workspace\vantage'
$env:WRANGLER_LOAD_DOT_ENV_FILES = 'false'
npx --no-install wrangler tail dontkillmyvibe --format pretty
```

For invocation errors only, replace the last line with
`npx --no-install wrangler tail dontkillmyvibe --status error --format pretty`.
That filter can miss caught application failures on otherwise successful requests;
use the unfiltered stream for `[derive]`, `[digest]`, `[paid]`, scheduled scan and
internal-route errors. Stop with Ctrl+C. For staging, use
`npx --no-install wrangler tail --env staging --format pretty` instead.

Treat raw logs as private and potentially sensitive. Never upload an unreviewed
tail, HTTP headers, request bodies or browser network export. Record only time,
route without sensitive query parameters, status, error category and a sanitised
correlation reference. Do not introduce an artificial production exception.

Cloudflare dashboard: **Workers & Pages → dontkillmyvibe → Observability** for
historical invocations/logs, and **Metrics** for errors, request volume and CPU.
Committed config enables observability; confirm the live deployment does too.
Watch the scheduled invocation at the top of the UTC hour (production config is
`0 * * * *`; staging is every three hours). In **Workflows**, check the existing
`vantage-scan` instance status without triggering or retrying it. In Resend, inspect
only Liam's delivery status/time; a provider acceptance is not inbox receipt.
Sentry and PostHog are not presently an alternative to these checks.

## Guided journey (one step at a time after Liam confirms)

Use **PASS**, **FAIL**, **BLOCKED** or **NOT RUN**; never infer a pass from code
or CI. A funnel means the real counts of conversations read, relevant and picked.
An IANA time zone is a named zone such as `Australia/Sydney`, which follows
daylight saving rather than fixing a UTC offset. Ask Liam to confirm each result
before proceeding. Screenshots must hide email addresses, codes and private text.

1. **Sign up.** Liam opens `https://contextfor.dev`, chooses sign-up, and uses his
   own email/account. He completes verification privately. Check successful entry
   into his workspace, no stale-cookie 500, and no other workspace's data. If he
   already has an account, do not delete it to manufacture a sign-up pass: record
   sign-in separately and leave new sign-up NOT RUN unless he approves a safe identity.
2. **Submit his URL.** Open `/workspace?setup=1` (or the current setup entry).
   Paste a public product URL Liam owns. Check that the returned **Your product
   profile** is derived from that site, not a generic/sample profile. Check browser
   requests complete without errors; retain no headers/cookies. A manual-question
   fallback is useful behaviour but does not pass URL-derived profile acceptance.
3. **Confirm the profile.** Review description, ideal customer, competitors,
   communities and keywords; correct errors, then choose **Confirm** per field or
   **Looks right**. Finish the digest question with `8am` and confirm the displayed
   device zone is `Australia/Sydney` (or Liam's actual intended zone). Reload and
   verify the confirmed profile persists. Do not silently accept a different zone.
4. **First scan and funnel.** The target is one automatically started first scan
   after profile completion, with real read/relevant/picked counts and a clear end
   state or next local scan time. Record counts and run time, not illustrative
   numbers. Main currently offers a manual **Scan now** control, not that full
   automatic funnel. If that is still deployed, mark this gate BLOCKED; a manually
   initiated scan is a separately authorised diagnostic, never an equivalent pass.
5. **Opportunities.** Once a genuine scan completes, open the workspace evidence
   and `/queue` for the same workspace. Check current, relevant conversations,
   evidence/source links, score reasons and no fixture/sample labels masquerading
   as live results. Record real read/relevant/picked counts and the number visible.
   The launch target is five worth joining; fewer results or an honest empty state
   must be recorded, not padded to five or called a full acceptance pass.
6. **Digest at the chosen local hour.** Under **Daily digest** (`/settings/digest`),
   enable delivery to Liam's address, keeping the existing hour unchanged so the
   onboarding local time/zone survives. Changing that form's UTC hour replaces the
   local schedule: do not use it to simulate an 8am local test. Record the zone,
   chosen local hour, corresponding dated UTC slot and actual inbox receipt time.
   Wait for the ordinary hourly schedule; do not call cron endpoints manually.
   First-ever delivery may catch up the previous slot immediately, and later sends
   are at least 20 hours apart (`lib/digest/schedule.ts`). Record a catch-up email
   separately and observe the next eligible local slot before passing local-hour
   timing. Empty eligible results skip email; no email is not a pass. Check up to
   five actual opportunities, sender, duplicate absence and delivery status.
7. **Email to in-app.** Click a digest opportunity. It must first open its
   `/opportunities/<id>` page in Liam's authorised workspace, not send him directly
   to the external source. If logged out, sign-in must return him to the intended
   app page. Source links should remain a distinct follow-up. Current main renders
   external source URLs in digest entries, so do not report this gate passed from
   code inspection or from a working external link.
8. **Copy a reply and record the outcome.** On an eligible opportunity, read the
   community rules and evidence, select the target conversation and choose
   **Generate contribution** only with Liam's spend approval. Check facts, edit the
   text and tick the rules/facts confirmations. Choose **Approve & copy draft**;
   verify clipboard text in a private local editor, then confirm persistence after
   reload. For venues prohibiting AI contributions, a research brief is the correct
   safety behaviour but not a reply-copy pass. The target includes a persisted
   `reply_copied` outcome; current main only persists draft approval, which is not
   proof that copying succeeded. Do not manually add an outcome to simulate it.
   Do not post, vote, comment or claim a published reply.

## Evidence ledger

Configuration confirmation: **NOT RECEIVED**. Account/spend approval: **NOT RECEIVED**.
Production deployed version: **NOT CHECKED**. Local/UTC test start: **NOT RUN**.
Owner's workspace reference: **not recorded** (keep identifying details private).

| Step | Status | Timestamp (local + UTC) | Sanitised evidence / counts / reason |
| --- | --- | --- | --- |
| 0. Secrets, budget, account approval and deployed version | BLOCKED | Not run | Awaiting Liam; names-only audit is not configuration confirmation. |
| 1. Sign-up / separately labelled sign-in | NOT RUN | — | No account interaction performed. |
| 2. URL-derived profile | NOT RUN | — | Awaiting gate 0. |
| 3. Confirmed profile + local schedule persists | NOT RUN | — | Awaiting gate 0. |
| 4. Automatic first scan + real funnel | NOT RUN | — | Source gap at audited revision; verify authorised deployed release first. |
| 5. Five relevant opportunities | NOT RUN | — | No scan or provider calls performed. |
| 6. Local-hour inbox digest | NOT RUN | — | No email sent; account, schedule and inbox evidence required. |
| 7. Digest opens in-app | NOT RUN | — | Source gap at audited revision: digest entries use external URLs. |
| 8. Clipboard + persisted reply-copy outcome | NOT RUN | — | Source gap at audited revision: approval is not a reply-copy outcome. |

For each authorised step, replace NOT RUN with the actual result and record the
observed deployed version, dated times and minimal evidence. A failure entry needs
expected versus actual behaviour and its blocking issue/release. No full-journey
pass or issue closure until every required gate has observed evidence.

## Repository verification for this documentation change

No migration is needed; no billing, auth, Wrangler or dependency change is part
of #107. Next remains pinned to 16.3.8. Verify or replace the full checkout path
below as described above before running these commands:

```powershell
Set-Location 'C:\Users\install\workspace\vantage'
pnpm lint
pnpm typecheck
pnpm test
node --test test/worker-entry.test.mjs test/scan-run.test.mjs test/queue-consumer.test.mjs
pnpm build
pnpm db:generate
git diff --exit-code -- drizzle
pnpm cf:build
pnpm exec wrangler deploy --dry-run --env staging --outdir .wrangler/audit-bundle
git diff --check
```

`pnpm typecheck` runs `tsc --noEmit`, lint runs `eslint`, and test runs the full
Vitest suite (automated code tests, not this production acceptance test). Keep
`LIVE_SMOKE` unset: live provider tests require separate approval. The last Worker
command is explicitly **dry-run**, a local packaging check, not permission to
deploy. CI checks the migration drift and Worker bundle/10 MB size gates. Require
green checks at the PR's current head and the repository's review/approval gates;
none grants permission to merge, deploy or run a paid production journey.
