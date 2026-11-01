# AR00 evidence and review status

**1 November 2026 · local proof passes; review BLOCKED; not ready to merge.**
AR01–AR05 are not implemented. No registration or MCP route is exposed by the
application. This does not claim the overall issue is complete.

| Definition of done | Result | Evidence |
| --- | --- | --- |
| Pinned MCP server answers fixture tools in workerd; rejects invalid identities, grants and other workspaces | PASS (local) | `test/agent-registration-compat.test.ts`: 17 passing tests, verbose targeted log |
| Pinned client discovers human issuer and completes PKCE before a Worker tool call | PASS (mock identity only) | Same suite; official client/server 2.4.0, jose 6.2.14, Wrangler 4.152.0, wire 2025-11-25; real test signatures, mocked Neon endpoints |
| No application routes, DB writes, providers, real credentials or production setup | PASS (scope) | Spike only under `scripts/spikes/agent-registration`; no application/lib/drizzle/wrangler changes; real identity and provider journeys not run |
| Record issuer/scope/configuration decisions and remaining staging checks | PASS (documented) | `06-ar00-compatibility-decision.md`; six proposed configuration names, no OAUTH_KV selected/provisioned; real Neon/native-client checks explicitly outstanding |

## Repository verification

- `pnpm lint`: pass, **0 errors / 30 pre-existing warnings** after removing the
  new anonymous-export warning.
- `pnpm typecheck`: pass.
- `pnpm test`: **203 files / 2,207 tests passed**, one live test skipped.
- `pnpm exec vitest run test/agent-registration-compat.test.ts --reporter verbose`:
  **17 passed** after final source edit.
- `pnpm build`: pass with synthetic DB/auth environment, before the final
  nonfunctional named-export lint fix in the isolated spike.
- `pnpm cf:build`: pass without DB/auth environment; existing generated
  Better Auth duplicate-key warnings remain. No deployment or upload performed.
- `node --test test/worker-entry.test.mjs test/scan-run.test.mjs test/queue-consumer.test.mjs`:
  **44 passed**.
- `git diff --check`: pass before commit.

The new direct jose pin also changes some Better Auth peer-resolution entries in
the generated lockfile. No auth source/package version was migrated; a real
Neon login regression check is still outstanding. Do not describe mocked auth
coverage as proof of that live flow.

## Failed paths retained, not hidden

1. Initial 2026 manual requests failed HTTP 400; other initial fixture issues
   included SSE-vs-JSON parsing and empty-subject validation. The second newer-
   protocol attempt still failed. Stopped after the second failure, reported to
   Liam, and selected the independently passing 2025 baseline. No third attempt
   to fix/claim the newer path; SDK capabilities are not inferred from this.
2. Fresh read-only Claude review attempted once with settings sources disabled
   and a **120-second deadline**, then once using the verified existing login
   with hooks/tools/MCP disabled and a **60-second deadline**. Both exited 124
   with empty stdout/stderr and no review findings or model identity. Stopped
   and reported after the second timeout. No third invocation, credentials
   change or claim that a different-model review passed. Normal `claude auth
   status` reports an existing login, so lack of login is NOT the diagnosed
   cause. Do not invent a network, billing or model explanation.

Each review invocation supplied a $0.50 CLI budget bound; no result/usage report
was returned, so actual review usage is unknown. No product model/provider was
called. A working different-model review is required before ready/merge; keep
the PR **draft**, do not waive the gate or continue feature coding past this
stop-and-report checkpoint. Greptile skips drafts and has not reviewed it.

Logs are local in `.evidence/test-agent-registration-compat/ar00/`; filenames,
commands and SHA-256 values are recorded in `ar00-validation-logs.json`.
No screenshots/video: no application UI changed. No real-database dataflow:
this isolated protocol proof adds no query. The named scope exceptions were
recorded before code in the definition of done; later slices still need both
appropriate runtime/dataflow and UI evidence. Nothing is deployed, no schema
is generated/applied, no flags/secrets are configured and no account is created.
