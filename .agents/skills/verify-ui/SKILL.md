---
name: verify-ui
description: Prove a frontend change works by using Vantage as a real user with Playwright CLI, saving screenshots and video as evidence. Use for any change a user can see or click.
---
# verify-ui

Done for UI work means a user can do the thing, in the real app, and there is a picture of it.

## Setup (once per machine)
```
npm install -g @playwright/cli@latest
playwright-cli install --skills
```
If the global command isn't available, `npx playwright cli` works the same way.

## Steps
1. **Start the real app.** `pnpm cf:preview` (real Worker runtime) for anything touching routes, auth or bindings; `pnpm dev` is fine for pure styling. Or use staging.
2. **Name the session after the branch** so runs don't collide: `playwright-cli -s=<branch> open <url>`.
3. **Record multi-step journeys:** `playwright-cli -s=<branch> video-start .evidence/<branch>/journey.webm`, add `video-chapter "<step>"` at each step, `video-stop` at the end.
4. **Walk every line of the definition of done as a user:** `snapshot` to get refs, then `click` / `fill` / `press`. No shortcuts through the API or DB.
5. **Screenshot each step:** `screenshot --filename=.evidence/<branch>/<nn>-<step>.png`. Include the empty state, the error state and a mobile view (`open --device="iPhone 15"`) when the change affects them.
6. **Check the console:** `playwright-cli -s=<branch> console error`. Any new error fails the check.
7. **Report:** a table with each definition-of-done line, pass/fail, and the screenshot that proves it. Attach screenshots/video to the PR.

## UX sign-off
Function is proven by the steps above; look and feel is Liam's call. Show him the screenshots, take his adjustments, re-shoot. Don't call a visual change done until he says he likes it.

## Rules
- Test against local, preview or staging. Never sign up, post or send email from production.
- Use sample accounts, never real customer data.
- `.evidence/` is gitignored. Evidence lives on the PR, not in the repo.
