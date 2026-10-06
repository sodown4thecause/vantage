# S07 — Browser Run helper with cost recording and SSRF guard

**Track:** Foundations · **Wave:** 1 · **Size:** S · **Owner:** agent · **Depends on:** none (binding added in S02; helper must work with an injected fake) · **Unblocks:** S21, S22, S30

## Outcome
One safe function wraps Cloudflare Browser Run Quick Actions for the rest of the codebase.

## Scope
- `lib/browser/run.ts`:
  ```ts
  browserMarkdown(url, opts?): Promise<{markdown: string; ms: number}>
  browserJson<T>(url, schema, opts?): Promise<{data: T; ms: number}>
  browserScreenshot(input: {url?: string; html?: string}, opts?): Promise<{png: Uint8Array; ms: number}>
  browserLinks(url, opts?): Promise<string[]>
  ```
  Each: validates URL with `isPublicHttpUrl` (`lib/http/public-fetch.ts`; reject private/loopback/non-http), enforces a timeout (default 20s) and a max output size, reads the binding via `getCloudflareContext().env.BROWSER`, calls `quickAction(...)`, reads `X-Browser-Ms-Used` and writes a `cost_event` (`provider: "cloudflare_browser_run"`, `action`, units = hours, price from `getUnitCost`; falls back to 0.09 $/hour), and checks the `browser_run` source switch.
- Denylist (code-level, tested): hosts `reddit.com`, `linkedin.com`, `facebook.com`, `instagram.com`, `x.com`, `twitter.com` are refused with a clear error (platform terms; see README).
- Fake binding for tests: `test/helpers/fake-browser.ts`.
- Docs: usage notes in `docs/browser-run.md` (limits: Free 10 min/day; Paid 10 h/month included; quickAction needs compat date >= 2026-03-24; `remote: true` for local dev).

## Acceptance criteria
- [ ] Tests: SSRF rejects, denylist rejects, timeout, size cap, cost row written with measured ms, switch-off blocks the call, error from binding is surfaced without leaking details.
- [ ] No page in the app calls the binding directly; they use this module (grep check in a test).

## Out of scope
Crawling jobs (`/crawl`) and full Puppeteer sessions; add only if a later slice needs them.

## Learned
- Implemented in `lib/browser/run.ts` with injectable `deps`; see `docs/browser-run.md`.
- `getUnitCost` did not exist; the helper queries `provider_price` directly with a 0.09 fallback.
- `quickAction` returns a Response with the REST `{success, result}` envelope; screenshot is raw bytes.
- Not verified against a live binding (S02 adds it).
