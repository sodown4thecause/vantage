# Landing product interest

The hero uses local keyword matching to suggest communities. It performs no live scan or model call. The three-conversation offer is marked Coming soon: submitting saves interest only and sends no email.

## Configuration (Liam only)

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: public Turnstile site key, available at build time and configured for the deployed hostname.
- `TURNSTILE_SECRET_KEY`: the matching private server verification key.
- `VISITOR_SALT`: server-only salt used by the existing public request guard to hash daily visitor identities.
- `DATABASE_URL`: existing Neon runtime connection. Apply the generated migration through the normal migration process before enabling capture.

No secrets are supplied or changed by this PR. A missing site key disables submission with an explanation. Missing server verification configuration fails closed. A Next build needs the public site key; adding it only after the build will not enable the widget. Never use test keys in production.

## Data and boundaries

`public_product_lead` stores an email, product description and creation time. It is a public marketing record, not a workspace lead, so it does not accept a workspace ID and exposes no read/update endpoint. Normalised emails are unique; repeated submissions do not overwrite the original description or reveal whether an address exists. No email, live discovery, subscription or account creation is triggered. The existing public guard enforces Turnstile and five submissions per visitor per UTC day before the insert. The database must have the existing public guard tables as well as the new table.

## Verification

On staging with the configuration in place: describe a product, inspect the suggested source list, enter an email and complete Turnstile. Submission should show “Your interest is saved”. Confirm one row using an authorised database connection; do not paste personal data into logs or PR comments. Repeat with the same email and confirm no duplicate or overwrite. An invalid/expired token must not insert a row. Check that no message is sent. Live three-conversation delivery is deliberately unfinished and labelled Coming soon.
