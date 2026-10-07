/** Primary venue policies checked 2026-10-07. An unchecked venue requires human review. */
export function contributionRule(platform: string, destination: string): {
  venue: string; aiText: "prohibited" | "unknown"; url: string | null;
} {
  let host = "";
  try { host = new URL(destination).hostname.toLowerCase().replace(/\.$/, ""); } catch { /* Unknown destination. */ }
  if (platform === "hn" || host === "news.ycombinator.com") {
    return { venue: "Hacker News", aiText: "prohibited", url: "https://news.ycombinator.com/newsguidelines.html" };
  }
  if (platform === "stackoverflow" || host === "stackoverflow.com" || host.endsWith(".stackoverflow.com")) {
    return { venue: "Stack Overflow", aiText: "prohibited", url: "https://stackoverflow.com/help/ai-policy" };
  }
  return { venue: platform || "Community", aiText: "unknown", url: null };
}
