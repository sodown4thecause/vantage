/** Signed-in app surfaces and APIs: nothing there is public content. */
export const PRIVATE_PATHS = ["/api/", "/auth/", "/admin/", "/workspace", "/content", "/queue", "/seo", "/review", "/onboarding", "/opportunities/", "/settings/"];

/**
 * Answer engines named explicitly so the marketing pages, blog and launch
 * catalog stay citable even if a default policy changes.
 */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
];
