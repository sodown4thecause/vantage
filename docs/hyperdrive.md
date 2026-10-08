# Hyperdrive database driver

Status: the seam ships **off**. With `VANTAGE_DB_DRIVER` unset, every query runs on neon-http exactly as before. Turning it on needs the operator steps below, because the Hyperdrive bindings need real config IDs that only exist after `wrangler hyperdrive create`.

## What the code does

- `getDb()` (`lib/db/client.ts`) is unchanged: synchronous, neon-http only, `Db` is the neon-http type.
- `getReadDb()` returns the cached `HYPERDRIVE` config when `VANTAGE_DB_DRIVER=hyperdrive`. Otherwise it returns `getDb()`.
- `getFreshDb()` returns the `HYPERDRIVE_FRESH` config (caching disabled) under the same flag. Otherwise it returns `getDb()`.
- `withTransaction(fn)` runs `fn` in a transaction on the fresh config. On neon-http it throws `Transactions require the Hyperdrive driver`.
- Missing bindings fall back to neon-http with one warning per binding. The warning never includes a connection string.
- Why async: the binding is read through `getCloudflareContext()`, which is async, and `postgres` is imported lazily so default bundles do not load it. `getDb()` stays sync because existing callers depend on it.
- Each call creates its own postgres-js client (`max: 5`, `fetch_types: false`). Clients are not cached on `globalThis`, because Hyperdrive pools connections itself.

## Which config to use

- `HYPERDRIVE_FRESH` (caching disabled): leases, budgets, source switches, auth, and any read-after-write query.
- `HYPERDRIVE` (cached, 60s, never invalidated): public read pages only.
- Queries that call `STABLE` functions such as `now()` are not cacheable. Do not rely on the cached config for time-dependent reads.

## Operator steps

1. Create the configs with the Neon direct (non-pooled) connection string:

   ```sh
   # production
   wrangler hyperdrive create vantage-fresh --connection-string="<neon direct url>" --caching-disabled
   wrangler hyperdrive create vantage-cached --connection-string="<neon direct url>"
   # staging
   wrangler hyperdrive create vantage-fresh-staging --connection-string="<neon staging direct url>" --caching-disabled
   wrangler hyperdrive create vantage-cached-staging --connection-string="<neon staging direct url>"
   ```

2. Add the bindings to `wrangler.jsonc` in all three places. Bindings are not inherited by `env.*`, so each block needs its own copy:

   ```jsonc
   // top level (default env) and env.production: production IDs
   "hyperdrive": [
     { "binding": "HYPERDRIVE", "id": "<vantage-cached id>" },
     { "binding": "HYPERDRIVE_FRESH", "id": "<vantage-fresh id>" }
   ]
   ```

   ```jsonc
   // env.staging: staging IDs
   "hyperdrive": [
     { "binding": "HYPERDRIVE", "id": "<vantage-cached-staging id>" },
     { "binding": "HYPERDRIVE_FRESH", "id": "<vantage-fresh-staging id>" }
   ]
   ```

   For the benchmark variant with a placement hint, add this to the same blocks. It is not committed:

   ```jsonc
   "placement": { "region": "aws:us-east-1" }
   ```

3. Set `VANTAGE_DB_DRIVER=hyperdrive` as a var on staging first. Leave production off until the benchmark gate below is met.

## Benchmark procedure

`scripts/db-bench.ts` runs the 12-query scan mix (workspace, sources, source switches, lease claim and release, 50 document selects, document lookup, unembedded count, recent documents, budget reads, and a no-op budget reserve). It prints p50 and p95 per query and for the whole mix. It refuses to run without an explicit `DATABASE_URL`.

```sh
DATABASE_URL="<neon direct url>" pnpm tsx scripts/db-bench.ts --driver=neon-http --workspace=<staging workspace uuid> --iterations=20
DATABASE_URL="<neon direct url>" pnpm tsx scripts/db-bench.ts --driver=postgres-js --workspace=<staging workspace uuid> --iterations=20
```

Use a staging workspace with at least one document and no scan running. Writes are net-zero: the lease is claimed and released, and the budget reserve adds 0.

Limitation: the script runs outside a Worker and cannot read Hyperdrive bindings. As committed, it measures direct connections only. Hyperdrive numbers need the same query mix run from inside a Worker that has the binding. That harness is not yet built (see Open items).

## Results

| Date | Driver | Placement | Workspace | Iterations | TOTAL p50 (ms) | TOTAL p95 (ms) | Notes |
|------|--------|-----------|-----------|------------|----------------|----------------|-------|
|      |        |           |           |            |                |                |       |

## Gate

Continue to Task 18 only if the benchmark shows a meaningful scan-time win for the Hyperdrive path (record the numbers above), or if transactions are wanted for Task 18. Otherwise keep the flag off.

## Open items

- Worker-side harness for Hyperdrive benchmark runs (the script above drives direct connections only).
- Confirm postgres-js prepared-statement behaviour through Hyperdrive during the staging run. The current client sets neither `prepare` nor `max` beyond `max: 5`.
