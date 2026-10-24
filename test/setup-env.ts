// Clear provider keys and paid/fixture opt-ins a developer shell may export, so test results never depend on the shell.
// Skipped when LIVE_SMOKE=1, because the opt-in live smoke test needs the real keys.
const SHELL_ENV_TO_CLEAR = [
  "TINYFISH_API_KEY",
  "FIRECRAWL_API_KEY",
  "FIRECRAWL_CREDIT_USD",
  "SCAVIO_API_KEY",
  "SCAVIO_GOOGLE_COST_USD",
  "VANTAGE_PAID_PROVIDERS_ENABLED",
  "VANTAGE_PAID_DAILY_BUDGET_USD",
  "AI_GATEWAY_API_KEY",
  "CF_AIG_BASE_URL",
  "CF_AIG_TOKEN",
  "INCO_API_KEY",
  "INCO_TRIAGE_ENABLED",
  "X_GATEWAY_EXPERIMENT_ENABLED",
  "YOUTUBE_API_KEY",
  "PH_DEV_TOKEN",
  "GITHUB_TOKEN",
  "VANTAGE_DEMO_FIXTURES",
  "ALLOW_FIXTURES",
  "TURNSTILE_SECRET_KEY",
  "RESEND_API_KEY",
  "TURNSTILE_DEV_BYPASS",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
] as const;

if (process.env.LIVE_SMOKE !== "1") {
  for (const name of SHELL_ENV_TO_CLEAR) delete process.env[name];
  for (const name of Object.keys(process.env)) {
    if (/^VANTAGE_PAID_DAILY_BUDGET_.+_USD$/.test(name)) delete process.env[name];
  }
}
