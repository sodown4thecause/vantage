# S04 — Source switch admin and paused-state UI

**Track:** Foundations · **Wave:** 1 · **Size:** S · **Owner:** agent · **Depends on:** none · **Unblocks:** S11, S13, S14, S42

## Outcome
The owner can pause or block any source type globally in two clicks, and users see a clear "Reddit paused" label instead of silence.

## Scope
- **Config:** env var `VANTAGE_ADMIN_USER_IDS` (comma-separated Neon Auth user ids); `lib/auth/admin.ts` `isAdmin(userId)` and `requireAdmin()` built on `lib/auth/server.ts`.
- **API:** `app/api/admin/switches/route.ts` — `GET` list, `PUT {sourceKey, state, reason}` (uses `setSourceSwitch` in `lib/sources/switch.ts`). Admin only; 404 for non-admins (do not reveal the route).
- **UI:** `app/admin/switches/page.tsx` table of all `SourceType` values with state, reason, changed-at, a form to change them. Plain server actions, no client library.
- **User-facing:** in `lib/sources/list.ts` + `app/settings/sources/page.tsx`, a source whose type is switched off shows coverage label **"Paused by operator: <reason>"**; extend `lib/collectors/coverage.ts` with a `paused_global` display (do not change persisted `source.health` values).
- **Collector run path:** `runCollector` already returns `switchedOff`; make `scanWorkspace` (`lib/cron/scan.ts`) surface it in `collectorResults` as `{skipped:true, reason:"source paused"}` and never count it as an error (`worker-entry.mjs` treats `error` as failure).
- **Audit:** `source_switch_log(id, source_key, from_state, to_state, reason, changed_by, changed_at)` appended on every change (migration).

## Acceptance criteria
- [x] Non-admin gets 404 on API and page; admin can flip a switch; log row written.
- [x] A switched-off source type produces no provider call (test with a fake collector) and appears as paused in Settings → Sources.
- [x] Tick result for paused sources has no `error` key (test in `test/cron-tick.test.ts` style).
- [x] Tests for `isAdmin` parsing (whitespace, empty, missing env).

## Out of scope
Automatic circuit breaking (a later improvement), per-workspace switches.

## Learned
- Migration 0012 (`source_switch_log`) is additive; apply to Neon branches is a human step. Set `VANTAGE_ADMIN_USER_IDS` as a Worker secret/var before the admin page is usable (until then everyone gets 404).
- `setSourceSwitch` now reads the previous state and appends a log row; neon-http has no transaction, so the upsert and log insert are two statements (a failure between them loses only the audit row).
- Paused display is derived in `listWorkspaceSources` (`displayCoverage: "paused_global"`, `pausedLabel`); `source.health` is never written by the switch.
- `lib/sources/keys.ts` lists switchable keys; add new `SourceType` values there too (slice README step 8).
- Scan only selects hn/rss/substack today, so the "source paused" skip appears for those until S11/S13/S14 widen the list.
