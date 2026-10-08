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
branch instead of `symlinkSync`. The `.pnpm` virtual store directory is still created
by pnpm, but the traced dependency tree no longer requires symlink recreation during
the OpenNext copy step.

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

### Rollback

Remove the `routes` block from `env.production`. The Worker then stops serving the
custom domains; it keeps serving on its existing `workers.dev` URL. No other change is
required to roll back.

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
