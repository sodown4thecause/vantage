import { getAllPosts } from "@/lib/blog";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SOURCES, absoluteUrl } from "@/lib/site";

export const dynamic = "force-static";

/** llms.txt (https://llmstxt.org): a plain summary of the site for language models and answer engines. */
export function GET(): Response {
  const posts = getAllPosts();
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_TAGLINE} ${SITE_DESCRIPTION}`,
    "",
    "Key facts:",
    `- Sources read: ${SOURCES.join(", ")}.`,
    "- Each conversation is scored for fit, intent, evidence, momentum and timing.",
    "- Users get up to five conversations a day, in their queue and a daily email digest.",
    "- It never posts, comments or sends messages on the user's behalf; the user writes every reply.",
    "- A free plan is available.",
    "",
    "## Product",
    "",
    `- [Home](${absoluteUrl("/")}): what ${SITE_NAME} does and how it works`,
    `- [Create a free account](${absoluteUrl("/auth/sign-up")})`,
    "",
    "## Guides",
    "",
    ...posts.map((p) => `- [${p.title}](${absoluteUrl(`/blog/${p.slug}`)}): ${p.description}`),
    "",
    "## Resources",
    "",
    `- [Where to launch a developer tool](${absoluteUrl("/launch")}): a hand-verified catalog of launch and listing destinations, with cost, link type and last-verified dates`,
    `- [Blog RSS feed](${absoluteUrl("/blog/rss.xml")})`,
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
