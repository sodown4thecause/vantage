# Specialized code review: required for every PR

Every pull request (slice, fix, or docs) goes through this process **before merge**. The author never reviews their own PR; a separate reviewer agent (or person) applies the lenses that match what the diff touches. A green CI run is necessary but not sufficient.

## 1. Gates, in order
1. **Automated:** GitHub Actions (`.github/workflows/ci.yml`) `verify` and `workers-build` green (lint, typecheck, tests, migration drift, Worker bundle under 10 MB, dry-run deploy with no secrets). Reviewers also re-run `pnpm lint && pnpm typecheck && pnpm test && node --test test/worker-entry.test.mjs` on the PR head when CI is not available.
2. **Specialized review:** the lenses below, chosen by the files changed (table in section 2).
3. **Slice contract:** acceptance criteria in the slice file are evidenced in the PR description; "Learned" notes added.
4. **Merge:** no open blocker or major finding; migration numbers checked against the base branch at merge time; human gates listed in the PR and not silently skipped.

## 2. Lenses (apply every one whose trigger matches)

| Lens | Trigger (files touched) | What the reviewer must check |
|---|---|---|
| **L1 Correctness and tests** | always | Does the code do what the slice says? Edge cases, error paths, concurrency. Tests prove behavior (not just that mocks were called). No network or real DB in tests. Existing tests unchanged unless justified. |
| **L2 Database and migrations** | `lib/db/schema.ts`, `drizzle/**`, any SQL | Additive only; no edits to migrations already on the base branch; filename/journal order; unique and foreign-key choices; indexes for the queries added; **every multi-step write is atomic or idempotent on neon-http (no interactive transactions)**; defaults/NOT NULL safe for existing rows; seed data idempotent; `pnpm db:generate` shows no drift. |
| **L3 Security and privacy** | `app/api/**`, `lib/auth/**`, public pages, anything reading headers/IPs/tokens | AuthZ via `authorizeWorkspace` or admin check; unauthenticated routes only expose public data; no raw IPs/PII stored; SSRF (`isPublicHttpUrl`), input validation and size limits; error responses leak nothing (`test/error-disclosure-contract.test.ts`); secrets never logged, committed or put in `NEXT_PUBLIC_*`; fail closed in production; timing-safe comparisons for secrets. |
| **L4 Cloudflare Workers / OpenNext runtime** | `worker-entry.mjs`, `wrangler.jsonc`, `open-next.config.ts`, `app/**` rendering mode, new dependencies | Works on Workers (no unsupported Node APIs or native modules); bundle size impact; bindings optional vs required and declared per env; queue/cron/workflow handlers re-enter the single bundle (no duplicate code copies); **no reliance on prerendering or an incremental cache (none configured: `/auth/*` 404 incident, 6 Oct)**; per-request CPU/time limits; `compatibility_date` features. |
| **L5 Cost and platform rules** | any outbound provider call, collectors, sources, pricing | Every paid/metered call goes through `recordCost`/`withCost`; source switch checked first and paused state is labelled; hard caps and quotas enforced before the call; **Vantage never writes, posts, DMs or votes on a third-party platform**; Browser Run never used for Reddit/LinkedIn/Facebook/Instagram/X; provider terms and rate limits respected; prices come from `provider_price`, not magic numbers. |
| **L6 Product, UX and copy honesty** | `app/**` pages, `docs/gtm/**`, public text | Empty/loading/error states; accessible forms and labels; mobile layout; every public claim is sourced and dated; wording is "I didn't find" not "nobody does"; example content is labelled as example; no fabricated customers, counts or outcomes; no AI-written outreach or comments. |
| **L7 Slice contract and docs** | always | Scope matches the slice file (nothing extra, nothing missing); acceptance criteria evidenced; out-of-scope items not smuggled in; docs and `.env.example` updated; human gates stated. |

## 3. Reviewer output format
One review comment per PR, ending with an attribution footer only when an AI agent wrote the review (the agent's own standard footer); a review written by a person carries no AI footer. Structure:

```
Verdict: APPROVE | APPROVE WITH NITS | CHANGES REQUESTED
Lenses applied: L1, L2, ...
Checks run: <commands and results>
Findings (most severe first):
- [blocker|major|minor|nit] <lens> `path:line`: what is wrong -> concrete failure scenario -> suggested fix
Not verified / needs a human: <items>
```

Severity: **blocker** = data loss, security hole, broken build/migration, violates a non-negotiable rule; **major** = wrong behavior in a realistic case, missing test for risky logic, will cause merge or deploy trouble; **minor** = should fix soon; **nit** = style. Only report findings you can tie to a specific line and a concrete failure. Do not pad. Do not push code to the PR; the author (or a fix agent) addresses findings, then the reviewer re-checks only the changed lines.

## 4. After review
- Blockers and majors: fix on the same branch, re-run checks, request re-review of the changes.
- Findings that belong to another slice: open an issue or add a line to that slice file under "Learned".
- Record the verdict in the slice status table (`docs/slices/README.md`) when merged.
