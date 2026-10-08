# Cloudflare Worker build fix (Windows) and contextfor.dev custom domain

Date: 2026-10-08
Branch: `fix/cloudflare-worker-build-and-domain`
Base: `origin/claude/distribution-engine-dev-tools-f7aac4`

## Problem 1 — Windows symlink EPERM during OpenNext build

### Error

Running `opennextjs-cloudflare build` (via `pnpm cf:build`) on native Windows failed
during bundle generation with:

```
EPERM: operation not permitted, symlink ...
    at symlinkSync (node:fs)
    at ... @opennextjs/aws/dist/build/copyTracedFiles.js
```

### Root cause

`@opennextjs/aws@4.1.7` `copyTracedFiles` recreates the pnpm `.pnpm` virtual-store
symlinks using a bare `symlinkSync` (no `type` argument). On Windows, creating a
symlink requires the `SeCreateSymbolicLinkPrivilege` (Windows Developer Mode or an
elevated process). Without it, `symlinkSync` throws `EPERM`.

### Fix

Set `nodeLinker: hoisted` in `pnpm-workspace.yaml`:

```yaml
nodeLinker: hoisted
```

With the `hoisted` linker, dependencies are placed in a flat top-level `node_modules`
with no symlinks, so OpenNext's trace copy takes the `copyFileAndMakeOwnerWritable`
branch instead of `symlinkSync`. Under `nodeLinker: hoisted`, pnpm does not create the
`.pnpm` virtual store; it writes plain, real directories into `node_modules`, so the
traced dependency tree no longer requires symlink recreation during the OpenNext copy
step.

### References

- Upstream issue: https://github.com/opennextjs/opennextjs-aws/issues/1184
- Upstream fix PR: https://github.com/opennextjs/opennextjs-aws/pull/1185
- Related (closed) Cloudflare issue: https://github.com/opennextjs/opennextjs-cloudflare/issues/414
- OpenNext Windows guidance: https://opennext.js.org/cloudflare

## Problem 2 — Serve `contextfor.dev` from the production Worker

The production Worker keeps its existing name `dontkillmyvibe` (existing deployed
resource; not renamed). `contextfor.dev` is a Cloudflare zone in the account. Two
custom domains are attached to `env.production` in `wrangler.jsonc`:

```jsonc
"routes": [
    { "pattern": "contextfor.dev", "custom_domain": true },
    { "pattern": "www.contextfor.dev", "custom_domain": true }
]
```

Rules honored: `custom_domain: true` with no `zone_name`/`zone_id`; routes are only on
`env.production` (not top-level, not staging); `name`, `services`, `triggers`,
`assets`, and `compatibility_*` are unchanged.

Sitemap origin: the project does not define a `vars` block anywhere in the repo, so no
`NEXT_PUBLIC_SITE_URL` var was added. `app/sitemap.ts` already defaults to
`https://contextfor.dev`, which matches the production domain.

### `www` behavior

Both apex (`contextfor.dev`) and `www` (`www.contextfor.dev`) are attached as separate
custom domains, so each is served directly with no automatic redirect between them. If
a single canonical host is wanted later, replace the `www` custom domain with a
Cloudflare redirect rule (for example, `www` → apex with a 301). This is an
informational note, not a blocker for launch.

## Required pre-launch operator steps

Complete these before announcing the custom domain as live:

- [ ] Add `contextfor.dev` **and** `www.contextfor.dev` to the Neon Auth trusted
      origins for the production Neon Auth project. Without this, sign-in/sign-up
      silently fails on the custom domain.
- [ ] Verify `contextfor.dev` is a Cloudflare zone in the same account as the
      `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` used to deploy. A custom domain
      cannot be attached if the zone lives in a different account.
- [ ] Expect the first deploy to lag while the TLS certificate for the custom domain
      is issued; the domain may serve errors or stale content until the cert is active.

### Rollback

Remove the `routes` block from `env.production`. The Worker then stops serving the
custom domains; it keeps serving on its existing `workers.dev` URL. No other change is
required to roll back.

## Cloudflare account cleanup (2026-10-08)

Verified via the Cloudflare API against account `eb1a55a5673488809e31067f32290af1`.

Three Cloudflare **Workers Builds** (git integrations) were connected to this repo on
branch `main`:

- `contextfor` — a dashboard "Hello world" template. Its build command was misconfigured
  (`root_directory` was set to the literal string
  `pnpm exec opennextjs-cloudflare build`). It owned the route `*.contextfor.dev/*`, so
  `https://contextfor.dev` served "Hello world" instead of Vantage.
- `vantage` — misconfigured build (`pnpm run build`, plain Next.js, not OpenNext), no
  route.
- `dontkillmyvibe` — the real application (`pnpm run cf:build`, OpenNext), no route.

**Removed (with owner approval):** the `contextfor` and `vantage` Workers Build
configurations and their placeholder Worker scripts. This freed the `*.contextfor.dev/*`
route so the real application's Worker can own the domain.

**Kept:** the `dontkillmyvibe` Worker (the real app). Its production environment now
declares `contextfor.dev` and `www.contextfor.dev` as `custom_domain` routes (see
`wrangler.jsonc`).

The real app previously served at `https://dontkillmyvibe.liam-wilson1990.workers.dev`;
staging at `https://vantage-staging.liam-wilson1990.workers.dev`.

### Promoting the fix to contextfor.dev

Deploy path:

1. This change is on `fix/cloudflare-worker-build-and-domain`; it lands via the open PR
   into `claude/distribution-engine-dev-tools-f7aac4`, and that branch reaches `main`
   through its own PR.
2. `.github/workflows/deploy.yml` deploys on `workflow_run` after CI succeeds on `main`
   (staging, when Cloudflare secrets exist) and via manual `workflow_dispatch` (choose
   `production`). Production deploys must be triggered manually.
3. On deploy, Wrangler attaches the `contextfor.dev` / `www.contextfor.dev` custom
   domains to the `dontkillmyvibe` Worker and issues TLS certs; the first request may lag
   until certs are active.
4. Required before the domain is usable: add both hostnames to Neon Auth trusted origins
   (see the pre-launch checklist above).
5. Rollback: remove the `routes` block from `env.production` and redeploy; the Worker
   keeps serving on its workers.dev URL.

## Verification evidence

Environment: native Windows, Node 25, pnpm 11.5.0, wrangler 4.147.0.

| # | Command | Result |
|---|---------|--------|
| 1 | `rm -rf node_modules && pnpm install --frozen-lockfile` | PASS — "Done in 46.9s"; `pnpm-lock.yaml` SHA256 unchanged (`44984908...9A71B`). |
| 2 | `pnpm lint` | PASS — exit 0. |
| 3 | `pnpm typecheck` | PASS — `tsc --noEmit` exit 0. |
| 4 | `pnpm test` | PASS — 62 files, 614 tests passed. |
| 5 | `node --test test/worker-entry.test.mjs` | PASS — 5 tests, 0 fail. |
| 6 | `rm -rf .open-next .next && pnpm cf:build` | PASS — exit 0; ends with ``Worker saved in `.open-next\worker.js` 🚀`` and `OpenNext build complete.` No EPERM. |
| 7 | `pnpm exec wrangler deploy --dry-run --env staging` | PASS — exit 0; `Total Upload: 14325.41 KiB / gzip: 2951.49 KiB`; binding `env.WORKER_SELF_REFERENCE (vantage-staging)`. |
| 8 | `pnpm exec wrangler deploy --dry-run --env production` | PASS — exit 0; `Total Upload: 14325.41 KiB / gzip: 2951.49 KiB`; binding `env.WORKER_SELF_REFERENCE (dontkillmyvibe)`. |
| 9 | `pnpm db:generate` + `git diff --exit-code -- drizzle` | PASS — "No schema changes, nothing to migrate"; diff exit 0 (no drift). |

### Notes on step 8 (routes confirmation)

`wrangler deploy --dry-run` (4.147.0) prints the upload summary and bindings but does
not print the resolved `routes`. To confirm the production routes authoritatively, the
Wrangler config resolver was called directly
(`unstable_readConfig({ config: "wrangler.jsonc", env: "production" })`):

```
resolved name: dontkillmyvibe
resolved routes: [
  { "pattern": "contextfor.dev", "custom_domain": true },
  { "pattern": "www.contextfor.dev", "custom_domain": true }
]
staging routes: null
top-level routes: null
```

This confirms both custom domains resolve under `env.production` only. The dry-run for
both envs exited 0, confirming the JSONC config (including `routes`) parses and
validates cleanly.

### Residual warnings (pre-existing, unrelated)

`cf:build` and the dry-runs emit `duplicate-object-key` esbuild warnings from bundled
`@neondatabase` SDK chunks (e.g. `OTP_EXPIRED`, `INVALID_OTP`). These originate in
third-party bundle code, are non-fatal, and are unaffected by this change.
