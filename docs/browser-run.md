# Browser Run helper

All Browser Run (formerly Browser Rendering) access goes through `lib/browser/run.ts`. Do not call `env.BROWSER` or `quickAction` anywhere else (a test greps for it).

## API
- `browserMarkdown(url, opts?)` -> `{ markdown, ms }`
- `browserJson<T>(url, jsonSchema, { prompt?, validate? })` -> `{ data, ms }` (AI extraction; also uses Workers AI)
- `browserScreenshot({ url } | { html }, opts?)` -> `{ png, ms }`
- `browserLinks(url, opts?)` -> `string[]`

Options: `timeoutMs` (default 20 000), `maxBytes` (default 1 000 000), `workspaceId`, extra Quick Action `params`, and `deps` (inject a fake binding, switch, price lookup and recorder in tests; see `test/helpers/fake-browser.ts`).

## What every call does
1. Rejects non-public URLs (`isPublicHttpUrl`) and the denylist: reddit.com, linkedin.com, facebook.com, instagram.com, x.com, twitter.com and subdomains (platform terms, bot-identifying crawler).
2. Checks the `browser_run` source switch (paused sources throw `source_paused`, never an empty result).
3. Calls `env.BROWSER.quickAction(action, params)` with a timeout and output size cap.
4. Reads `X-Browser-Ms-Used` and writes a `cost_event` (`provider: cloudflare_browser_run`, units = hours, price from `provider_price` or 0.09 USD/hour). Failures are recorded at zero cost unless time was measured.
5. Throws `BrowserRunError` with a fixed message and a `code`; binding errors are never surfaced.

## Limits and setup
- Free plan: 10 browser minutes per day. Workers Paid: 10 browser hours per month included, then 0.09 USD/hour.
- `quickAction` needs `compatibility_date` >= 2026-03-24 and `"remote": true` on the browser binding for local `wrangler dev`.
- The `browser` binding is added to `wrangler.jsonc` by slice S02; until then `getBinding` returns undefined and calls throw `binding_missing`.

## Learned
- `quickAction` returns a `Response`; the body is the REST envelope `{ success, result }` (screenshot is raw PNG). The helper unwraps it.
- `/json` takes `response_format: { type: "json_schema", json_schema }` and optionally `prompt`.
- There was no `getUnitCost` in the ledger on this branch, so the helper reads `provider_price` itself and falls back to 0.09.
- `screenshot({ html })` renders caller-supplied HTML in a remote browser; only pass trusted HTML.
- Not wired to a real binding yet, so the real response shape is verified only against the docs, not live.
