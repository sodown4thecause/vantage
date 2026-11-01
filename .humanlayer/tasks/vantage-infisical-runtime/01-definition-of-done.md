# Infisical agent/runtime connection — definition of done

User authorised checking/preparing only liam-agentbox, not copying the
hurdles-roger identity. Instance https://infisical.contextfor.dev; project
7fb6b279-71e8-4775-9cb9-55dcc8404733 (my env list), environment dev, secret path /.

1. Report only integration/CLI/identity availability, protected-file permissions
   and connection status; never show credentials or vault secret values.
2. Prepare a verified CLI and protected-file authentication path, locked to this
   project/dev/root with explicit per-operation key selection and read-only use.
3. Test unsafe-file rejection, absence/failure redaction and exact-key-only
   retrieval without live credentials; if connected, verify requested keys by
   presence/count only. No vault-wide export/list of all 38 entries.
4. Report CONNECTED or BLOCKED and exact owner-side provisioning; no application
   code, deployment, key rotation, other VM identity or unrelated service changes.

Workflow: HumanLayer Freeform, local task 01a19546-1364-7b32-b101-93545399de5a.
Proof is local CLI/safety tests, metadata-only inspection and status checks.
Application UI/database skills do not apply: no app/UI/query change. Independent
review through the previously stalled Claude path will not be retried; report
review limitations explicitly, never imply a review or live connection passed.
