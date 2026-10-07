# Browser Run helper

All Browser Run (formerly Browser Rendering) access goes through `lib/browser/run.ts`. Do not call `env.BROWSER` or `quickAction` anywhere else (a test greps for it).

## API
- `browserMarkdown(url, opts?)` -> `{ markdown, ms }`
- `browserJson<T>(url, jsonSchema, { prompt?, validate? })` -> `{ data, ms }` (AI extraction; also uses Workers AI)
- `browserScreenshot({ url } | { html }, opts?)` -> `{ png, ms }`
- `browserLinks(url, opts?)` -> `string[]`

Options: `binding` or `env` (pass explicitly from Workflows, queues and cron, where there is no OpenNext request context; the default `getCloudflareContext()` path converts any failure into `binding_missing`), `timeoutMs` (default 20 000), `maxBytes` (default 1 MB, 10 MB for screenshots), `workspaceId`, extra Quick Action `params`, and `deps` (inject a fake binding, switch, price lookup and recorder in tests; see `test/helpers/fake-browser.ts`).

## What every call does
1. Rejects URLs that are not syntactically public HTTP(S) (`assertBrowsableUrl`, which uses `isPublicHttpUrl`: scheme, no credentials, standard ports, a dotted hostname that is not an IP literal or `.local`/`.internal`/`.localhost`) and the denylist: reddit.com, linkedin.com, facebook.com, instagram.com, x.com, twitter.com and subdomains (platform terms, bot-identifying crawler). This is a hostname check only: it never resolves DNS, so a public-looking domain that resolves to a private address is not caught here. Browser Run fetches from Cloudflare's network, not from inside the Worker or our infrastructure, which limits the SSRF blast radius, but treat the check as best-effort and never pass user-supplied URLs for sensitive purposes without further review.
2. Checks the `browser_run` source switch (paused sources throw `source_paused`, never an empty result).
3. Calls `env.BROWSER.quickAction(action, params)` with a timeout and output size cap.
4. Reads `X-Browser-Ms-Used` and writes a `cost_event` (`provider: cloudflare_browser_run`, units = seconds because `cost_event.units` is numeric(14,4), price = the `provider_price` row `browser_run` / `browser_hour` (USD per hour, same row for every quick action) / 3600, default 0.09 USD/hour; the cost event itself is recorded under provider `cloudflare_browser_run` with the quick action as its action). A missing header or a timeout falls back to measured wall time and is charged, since the call may still be billing. Only calls that reach the binding are recorded: rejections before it (invalid or denied URLs, paused source, missing binding) throw without writing a `cost_event`, so operators should not expect rows for rejected attempts. Calls that reach the binding and fail are recorded with `ok: false` and charged for the measured (or wall-clock) time.
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
- The docs document no abort signal for `quickAction`, so a timeout stops waiting but cannot cancel the call; the elapsed time is recorded instead.
- Short-link redirectors (redd.it, t.co, lnkd.in, fb.com, fb.me, fb.watch, instagr.am) are denied; other redirectors that land on denied platforms cannot be detected without resolving them.
