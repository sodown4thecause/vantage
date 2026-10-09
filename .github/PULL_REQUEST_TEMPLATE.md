## What this changes

<!-- One or two sentences, in plain language. -->

## Customer journey affected

- [ ] Sign-up / workspace onboarding
- [ ] Source configuration
- [ ] Collection / scoring
- [ ] Review queue actions
- [ ] Daily digest

## Safety checklist

- [ ] Every new query or mutation is workspace-scoped (tenant isolation)
- [ ] No secrets, tokens or customer data appear in code, logs, tests or fixtures
- [ ] Error messages returned to customers stay generic (internal detail goes to logs)
- [ ] New user-supplied URLs pass the fetch policy in `lib/collectors/safeFetch.ts`
- [ ] New fixtures are disabled in production via `ALLOW_FIXTURES` unless intentional

## Migrations

- [ ] No schema change, or the migration is additive (expand/contract: nothing dropped in this release)
- [ ] `drizzle/meta/_journal.json` churn is the only generated change (CI drift gate ignores it)

## Verification

<!-- Commands run and their result, e.g. pnpm lint/typecheck/test/build, or the
     staging E2E journey driven through the agent browser. -->

## Notes for reviewers

<!-- Optional: what to look at first, or anything intentionally left out of scope. -->
