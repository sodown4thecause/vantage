# liam-agentbox Infisical setup — PREPARED, CONNECTION BLOCKED

Date: 1 November 2026. No application code, deployments, rotation, other-VM
credentials or unrelated service changes.

## Findings

- Documented exe.dev reflection integration lists no Infisical/vault connection.
- No Infisical CLI, named launchers, Infisical-related environment names or known
  Infisical/agent-secrets credential locations found before setup. Inspected
  names, availability and permissions only, not credential contents.
- HTTPS GET of the supplied vault's public root returned **200**, with default
  certificate verification. This proves web reachability, not authentication.
- No identity supplied, no login attempt and **zero vault secret reads**.
  The user's count of 38 stored entries was not fetched or enumerated.

## Prepared locally, outside the app

- Official Infisical CLI **0.44.11** at `/home/exedev/.local/bin/infisical`.
  Compared the Linux amd64 archive against the official release's Linux
  `checksums.txt`: SHA-256
  `d5f7ea6b9e9238e150695dafe6f06c0baa06a6e1dd942d12896c797c386a8092`.
  This is a same-publisher integrity check, not independent signature attestation.
  The similarly named `cli_0.44.11_checksums.txt` contained only a Windows entry;
  the first lookup stopped before installation and used no unchecked binary.
- New credential directory `/home/exedev/.config/vantage-vault`, exedev-owned,
  **0700**. `machine-identity.json` deliberately **does not exist**: no invented,
  copied or placeholder identity. No Infisical login profile/token saved.
- `/home/exedev/.local/bin/vantage-vault-check`, exedev-owned, **0700**, matches
  the committed runtime source. It accepts only explicit keys from the current
  Neon task allowlist and uses documented API metadata reads. No general secret
  export, child-command injection, write API, import resolution or retry loop.
  The CLI itself is installed but intentionally not authenticated/configured as
  a global profile. The checker authenticates directly over HTTPS when a secure
  file is later supplied, so a login token need not pass through CLI output.

The checker loads Universal Auth client credentials from the protected file,
keeps the login token in memory and requests one exact secret at a time with
`viewSecretValue=false`, `expandSecretReferences=false`, `includeImports=false`.
Project, environment and path are fixed to the user's supplied target. TLS is
verified, redirects are refused, proxy overrides ignored, error bodies suppressed, unexpected value-bearing metadata responses refused,
core dumps disabled in the checker process, and a 30-second process deadline
bounds checks. No credentials in arguments, global environment, git or output.

Only current-task key names are eligible: NEON_API_KEY, DATABASE_URL,
NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET. A call must specify its exact subset;
start with **NEON_API_KEY only**, not all four. These are candidate needed names,
not a claim that they exist in the vault. Unknown names require a deliberate
allowlist update and justification, never a bulk list to discover them.

## Evidence

| Definition of done | Result | Evidence |
| --- | --- | --- |
| Inspect connection/identity availability without values | PASS; no connection found | Reflection metadata, environment names, path/permission inspection; HTTPS 200 only |
| Prepare verified CLI and scoped protected-file access | PASS (prepared only) | CLI version + checksum; helper source; directory/file modes; no actual identity |
| Test unsafe files, errors and key-only access; verify live only if connected | PASS local; live BLOCKED | **20 synthetic tests passed**; installed `--check-setup` exits 2 with credential-not-provisioned message |
| Report exact provisioning; no app/deploy/service changes | PASS (handoff) | `03-secure-provisioning.md`; app/lib/drizzle/package/wrangler unchanged |

Tests cover private/read-only files, unsafe permissions, symlinks, parent
symlinks, hardlinks, missing/invalid JSON, exact per-key query/response scope,
redacted HTTP errors/argument misuse, redirect refusal, unsupported keys,
counts-only output, no-key/no-network, setup-only/no-login and no automatic retry.
No test contacts the vault. Synthetic fixture strings are not credentials.

This is a VM-ops task. App UI, database/dataflow, pnpm/build checks are not
applicable: app sources, dependencies, schemas and config are unchanged. Local
runtime tests replace those checks for this scope. The previously stalled
Claude review route was not invoked again; different-model security review is
**not claimed**, and no app merge/deploy is attempted. The checker is prepared
but remains unusable without owner-provisioned identity; RBAC and the live API
contract are unverified. File checks cannot prove the identity is actually Viewer.

Next: owner supplies a new least-privilege identity through the protected file
or an authorised secure integration; then run one metadata-only key check.
A `dev` vault environment does NOT prove the stored database points at staging.
Even after vault access works, verify intended Neon project/branch before any
Vantage database/auth usage. No application secret injection in this task.
