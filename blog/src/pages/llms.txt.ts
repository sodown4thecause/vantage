import type { APIContext } from 'astro';
import { getPublishedPosts, postPath } from '../lib/posts';

// llms.txt: a plain-text index of posts for LLM crawlers and agents.
export async function GET({ site }: APIContext) {
  const posts = await getPublishedPosts();
  const lines = posts.map((p) => `- [${p.data.title}](${new URL(postPath(p), site).href}): ${p.data.description}`);
  return new Response(
    `# Vantage Blog\n\n> Insights and playbooks from the Vantage team.\n\n## Posts\n\n${lines.join('\n')}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
