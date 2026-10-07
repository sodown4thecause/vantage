# Contributing

Thanks for taking a look at **vantage-ingest**. This is a Cloudflare Workers +
Neon Postgres pipeline written in TypeScript. Contributions, issues, and source
suggestions are welcome.

## Local setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Environment** — `npm run smoke` and `npm run typecheck` need no secrets.
   To run the full worker locally you need a Neon `DATABASE_URL` and an
   `INCO_API_KEY`; see `.env.example` for the full list of variables. To use them
   locally, put them in a **git-ignored** file (`.dev.vars` is the Wrangler
   convention, and is already ignored) or export them in your shell.

3. **Run locally**

   ```bash
   npm run dev        # wrangler dev; simulates cron and queues
   npm run migrate    # apply migrations to DATABASE_URL (needs the connection string)
   ```

## Checks before you open a PR

Run both of these; they are fast and require no network or database.

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # pure-logic tests via tsx
```

`npm run smoke` exercises the boundary logic: registry expansion, URL
canonicalization, feed parsing, in-batch dedup, the `/signals` chunker, classifier
schema validation, the bounded-repair path, the version-keyed write guard, and
entity canonicalization. If you change any of that logic, add or update a check in
`scripts/smoke.ts`.

## Secret hygiene

This repository must never contain a real key, token, or connection string.

- **Never commit secrets.** Not in code, not in `.env`, not in a test, not in a
  fixture, not in a comment.
- Real environment files (`.env`, `.env.*`, `.dev.vars`, `*.local`) are git-ignored.
  Only `.env.example` — with placeholder values — is tracked.
- Secrets in production go through `wrangler secret put`, not files.
- The inference key is read **only** from `env.INCO_API_KEY` and is never logged,
  never embedded in error messages, and never returned to callers. Keep it that way.
- If you think you have committed a secret, rotate it immediately. Rewriting history
  is not enough on its own; assume an exposed key is compromised.

## Source changes

Sources are configuration, not code. Most "add a source" changes are a few lines in
`src/registry/seed.ts` — see the **Configuration** section of the README. Keep
per-source rate limits honest: if a host documents a quota, capture it in the
entry's `rateLimit` and note it.

## Pull requests and OpenCode

This repository uses **OpenCode** for GitHub PR automation. The workflow
(`.github/workflows/opencode.yml`) runs on issue and review comments that contain
`/oc` (or `/opencode`).

- Mention **`/oc`** in a comment to invoke OpenCode on a PR or issue.
- Keep commit messages and PR descriptions focused on the *why*.
- Prefer small, reviewable changes over large mixed ones.
