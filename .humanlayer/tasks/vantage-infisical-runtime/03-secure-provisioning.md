# Owner action needed: dedicated read-only identity

**Status: prepared, not connected.** No secret values should be sent in chat.
Do not copy hurdles-roger's identity or launchers.

## 1. Create/assign a dedicated identity in Infisical

In the organisation containing project **my env list**
(`7fb6b279-71e8-4775-9cb9-55dcc8404733`), create a machine identity such as
**liam-agentbox-shelley-vantage** with **Universal Auth**.

- Use the least-privilege non-admin organisation role available.
- Assign the identity to this project as **Viewer/read-only** or a narrower
  custom role. Allow only necessary secret metadata/value reads in **dev**, path
  **/**; no create/update/delete, rotation, administration or other environments.
- Built-in Viewer may cover more of the project than this task needs. Check
  actual server-side scope rules; a local key allowlist does not narrow the
  credential's real authority. If the instance cannot restrict the role to
  dev/root, resolve a narrower policy/project arrangement rather than silently
  granting broad access. Do not upgrade licences or change policy automatically.
- Prefer short access-token TTL and max TTL (e.g. **900 seconds**), with periodic
  non-expiring access disabled. Use a finite client-secret lifetime appropriate
  to your policy. Trusted-IP restrictions are optional only if your plan supports
  them and this VM's stable outbound IP is confirmed; do not guess an address.
- This creates a new VM-specific identity, not rotation of any existing key.

## 2. Provision through a protected channel, not this chat

Using secure file transfer or an interactive editor on **liam-agentbox**, supply:

`/home/exedev/.config/vantage-vault/machine-identity.json`

The file must contain a JSON object with exactly two string fields:
`client_id` and `client_secret`, populated with the new Universal Auth pair.
Do not use an account password, another VM's pair, an admin credential or a
long-lived global token. Do not paste the pair into chat, terminal command
arguments, shell history, an echo/heredoc command, git or screenshots.

Permissions: directory **0700**; file **0600** (or **0400**); both owned by
**exedev**, no symlinks or hardlinks. The directory is already prepared. No
credential file was created; do not mistake a placeholder/example for an identity.
If your provisioning tool writes the file as root, have that secure tool set
its owner/mode correctly. Do not loosen permissions to make the checker work.

An authorised exe.dev integration is an alternative only once its actual
supported route/authentication is configured and checked. No such Infisical
integration was found or created here; no unsupported endpoint is assumed.

## 3. Verify only what is needed

Safe local validation (no login/network):

```sh
/home/exedev/.local/bin/vantage-vault-check --check-setup
```

Then the first needed check, without requesting secret values:

```sh
/home/exedev/.local/bin/vantage-vault-check NEON_API_KEY
```

This performs one login and one exact-key metadata request, with no automatic
retry. Output is only connection status and counts; it never lists the 38 entries
or prints values. A missing/non-visible key or unsupported server API stays
BLOCKED, not a claim of successful project access. Do not fall back to exporting
all secrets or retrieving plaintext just to make a presence check succeed.

This verifies Infisical access, **not** Neon API authentication or a staging DB.
No general `infisical run`, `infisical export`, `.env` generation, application
startup/deployment, provider spend or service restart is part of this setup.
Future runtime use must name its exact keys and verified staging target first;
secret injection is not implemented by this presence-only checker.
